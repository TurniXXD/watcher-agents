import type { Source, WatchItem } from '@watcher/core';
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

const cacheDurationMs = 15 * 60_000;
const navigationTitle =
  /^(?:about|careers|contact|home|investors?|news(?:room)?|press releases?|read more|learn more|view all|media|search|subscribe)$/i;

const normalizeTitle = (value: string): string =>
  normalizeWhitespace(stripHtml(value));

const listingEntries = (pageUrl: string, html: string): ListingEntry[] => {
  const page = assertPublicHttpUrl(pageUrl);
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

  public constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly resolvePublicUrl: typeof assertPublicHttpUrlResolved = assertPublicHttpUrlResolved,
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
    );
    const entries = listingEntries(endpoint.url, html);
    this.#listings.set(endpoint.url, {
      entries,
      expiresAt: Date.now() + cacheDurationMs,
    });
    return entries;
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
    const items: WatchItem[] = [];
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      const { endpoint, entries } = result.value;
      for (const entry of entries) {
        items.push({
          id: `${this.id}:${profile.symbol}:${entry.url}`,
          source: this.id,
          externalId: `${profile.symbol}:${entry.url}`,
          title: entry.title,
          url: entry.url,
          content: `${endpoint.name} published this announcement. Monitoring focus for ${profile.symbol}: ${profile.focus}.`,
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
          },
        });
      }
    }
    return items;
  }
}
