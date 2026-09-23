import { SourceHttpError, type Source, type WatchItem } from '@watcher/core';
import {
  assertPublicHttpUrl,
  assertPublicHttpUrlResolved,
} from '../utils/network.js';
import {
  fetchPublicText,
  htmlAttribute,
  normalizeWhitespace,
  stripHtml,
} from '../utils/http.js';
import {
  companyIntelligenceProfileFor,
  type CompanyIntelligenceEndpoint,
} from './profiles.js';

export type CompanyIntelligenceConfig = {
  symbol: string;
};

type ListingEntry = {
  title: string;
  url: string;
};

type CachedListing = {
  expiresAt: number;
  entries: readonly ListingEntry[];
};
type CachedArticle = {
  expiresAt: number;
  excerpt: string | null;
};

export type CompanyIntelligenceIssue = {
  symbol: string;
  endpoint: string;
  stage: 'LISTING' | 'ARTICLE';
  errorKind: string;
};

const issueKind = (error: unknown): string =>
  error instanceof SourceHttpError
    ? `HTTP_${error.status}`
    : error instanceof Error
      ? error.name
      : 'UNKNOWN';

const cacheDurationMs = 15 * 60_000;
const navigationTitle =
  /^(?:about|careers|contact|home|investors?|news(?:room)?|press releases?|read more|learn more|view all|media|search|subscribe)$/i;

const normalizeTitle = (value: string): string =>
  normalizeWhitespace(stripHtml(value));

const articleExcerpt = (html: string, title: string): string | null => {
  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1];
  if (article) {
    const text = stripHtml(
      article.replace(
        /<(?:nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/(?:nav|header|footer|aside)>/gi,
        ' ',
      ),
    );
    if (text.length >= 100) return text.slice(0, 3_500);
  }
  const titleWords = new Set(
    title
      .toLowerCase()
      .match(/[a-z]{5,}/g)
      ?.slice(0, 12) ?? [],
  );
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const name = htmlAttribute(tag, 'property') ?? htmlAttribute(tag, 'name');
    if (!/^(?:og:description|description)$/i.test(name ?? '')) continue;
    const description = normalizeWhitespace(
      htmlAttribute(tag, 'content') ?? '',
    );
    const overlaps = [...titleWords].filter((word) =>
      description.toLowerCase().includes(word),
    ).length;
    if (description.length >= 100 && overlaps >= 2) {
      return description.slice(0, 1_000);
    }
  }
  return null;
};

const micronNewsroomEntries = (html: string): ListingEntry[] => {
  const entries: ListingEntry[] = [];
  const teaser =
    /<h2\b[^>]*class=["'][^"']*cmp-teaser__title[^"']*["'][^>]*>([\s\S]*?)<\/h2>([\s\S]{0,2000}?)<a\b([^>]*?)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(teaser)) {
    const title = normalizeTitle(match[1] ?? '');
    if (title.length < 20 || title.length > 300) continue;
    if (!/^read article$/i.test(normalizeTitle(match[4] ?? ''))) continue;
    const href = htmlAttribute(match[3] ?? '', 'href');
    if (!href) continue;
    try {
      const url = assertPublicHttpUrl(href);
      if (
        (url.hostname === 'investors.micron.com' &&
          url.pathname.startsWith('/news/press-release/')) ||
        (url.hostname === 'www.micron.com' &&
          url.pathname.startsWith('/about/press/news/'))
      ) {
        entries.push({ title, url: url.toString() });
      }
    } catch {
      // A malformed or unsafe article URL is not a company event.
    }
    if (entries.length === 1) break;
  }
  return entries;
};

const listingEntries = (
  endpoint: CompanyIntelligenceEndpoint,
  html: string,
): ListingEntry[] => {
  if (endpoint.articlePathPrefix === '/about/press/news/') {
    const newsroom = micronNewsroomEntries(html);
    if (newsroom.length > 0) return newsroom;
  }
  const page = assertPublicHttpUrl(endpoint.url);
  const entries = new Map<string, ListingEntry>();
  for (const match of html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
    const tag = match[0];
    const href = htmlAttribute(tag, 'href');
    const title = normalizeTitle(tag);
    if (
      !href ||
      title.length < 20 ||
      title.length > 300 ||
      navigationTitle.test(title)
    ) {
      continue;
    }
    let url: URL;
    try {
      url = assertPublicHttpUrl(new URL(href, page).toString());
    } catch {
      continue;
    }
    if (url.origin !== page.origin || url.pathname === page.pathname) continue;
    if (
      endpoint.articlePathPrefix &&
      !url.pathname.startsWith(endpoint.articlePathPrefix)
    ) {
      continue;
    }
    entries.set(url.toString(), { title, url: url.toString() });
  }
  return [...entries.values()].slice(0, 1);
};

export class CompanyIntelligenceSource implements Source<CompanyIntelligenceConfig> {
  public readonly id = 'COMPANY_INTELLIGENCE';
  public readonly capabilities = {
    sourceName: 'Company intelligence',
    sourceType: 'NEWS' as const,
    minimumIntervalMs: 5 * 60_000,
    preferredIntervalMs: 15 * 60_000,
    maximumIntervalMs: 60 * 60_000,
    supportsStreaming: false,
    costPerRequestUsd: 0,
    rateLimitPerMinute: null,
    priority: 85,
  };
  readonly #listings = new Map<string, CachedListing>();
  readonly #articles = new Map<string, CachedArticle>();

  public constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly resolvePublicUrl: typeof assertPublicHttpUrlResolved = assertPublicHttpUrlResolved,
    private readonly onIssue?: (issue: CompanyIntelligenceIssue) => void,
  ) {}

  async #entriesFor(
    endpoint: CompanyIntelligenceEndpoint,
    signal?: AbortSignal,
  ): Promise<readonly ListingEntry[]> {
    const cached = this.#listings.get(endpoint.url);
    if (cached && cached.expiresAt > Date.now()) return cached.entries;
    const html = await fetchPublicText(
      this.fetcher,
      endpoint.url,
      signal,
      this.resolvePublicUrl,
      'text/html',
    );
    const entries = listingEntries(endpoint, html);
    this.#listings.set(endpoint.url, {
      entries,
      expiresAt: Date.now() + cacheDurationMs,
    });
    return entries;
  }

  async #articleFor(
    entry: ListingEntry,
    symbol: string,
    endpoint: CompanyIntelligenceEndpoint,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const cached = this.#articles.get(entry.url);
    if (cached && cached.expiresAt > Date.now()) return cached.excerpt;
    let excerpt: string | null = null;
    try {
      const html = await fetchPublicText(
        this.fetcher,
        entry.url,
        signal,
        this.resolvePublicUrl,
        'text/html',
      );
      excerpt = articleExcerpt(html, entry.title);
    } catch (error) {
      if (signal?.aborted) throw error;
      this.onIssue?.({
        symbol,
        endpoint: endpoint.name,
        stage: 'ARTICLE',
        errorKind: issueKind(error),
      });
    }
    this.#articles.set(entry.url, {
      expiresAt: Date.now() + cacheDurationMs,
      excerpt,
    });
    return excerpt;
  }

  public async fetch(
    config: CompanyIntelligenceConfig,
    signal?: AbortSignal,
  ): Promise<WatchItem[]> {
    const profile = companyIntelligenceProfileFor(config.symbol);
    if (!profile) return [];
    const results = await Promise.allSettled(
      profile.endpoints.map(async (endpoint) => ({
        endpoint,
        entries: await this.#entriesFor(endpoint, signal),
      })),
    );
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') {
        this.onIssue?.({
          symbol: profile.symbol,
          endpoint: profile.endpoints[index]!.name,
          stage: 'LISTING',
          errorKind: issueKind(result.reason),
        });
      }
    }
    if (results.every((result) => result.status === 'rejected')) {
      throw new Error(
        `All company intelligence listings failed for ${profile.symbol}`,
      );
    }
    const items = await Promise.all(
      results.flatMap((result) => {
        if (result.status !== 'fulfilled') return [];
        const { endpoint, entries } = result.value;
        return entries.map(async (entry): Promise<WatchItem> => {
          const excerpt = await this.#articleFor(
            entry,
            profile.symbol,
            endpoint,
            signal,
          );
          return {
            id: `${this.id}:${profile.symbol}:${entry.url}`,
            source: this.id,
            externalId: `${profile.symbol}:${entry.url}`,
            title: entry.title,
            url: entry.url,
            content: excerpt
              ? `Publisher article excerpt: ${excerpt}`
              : `Headline only; article text unavailable: ${entry.title}`,
            sourceType: 'NEWS',
            primarySource: endpoint.relationship === 'SUBJECT',
            category:
              endpoint.relationship === 'SUBJECT'
                ? 'COMPANY_EVENT'
                : 'COMPETITOR_EVENT',
            entities: [
              profile.symbol,
              endpoint.name,
              ...(endpoint.relatedTicker ? [endpoint.relatedTicker] : []),
            ],
            reliability: endpoint.relationship === 'SUBJECT' ? 0.95 : 0.85,
            metadata: {
              symbol: profile.symbol,
              companyIntelligence: true,
              companyIntelligenceRelationship: endpoint.relationship,
              relatedCompany: endpoint.name,
              relatedTicker: endpoint.relatedTicker,
              focus: profile.focus,
              articleTextAvailable: excerpt !== null,
            },
          };
        });
      }),
    );
    return items;
  }
}
