import {
  assertPublicHttpUrl,
  assertPublicHttpUrlResolved,
} from '@watcher/core';
import { XMLParser } from 'fast-xml-parser';
import { fetchWithTrendRetry, type TrendHttpOptions } from './http.js';
import {
  canonicalTrendUrl,
  safeExternalExcerpt,
  trendSignalSchema,
  type TrendSignal,
  type TrendSource,
  type TrendSourceContext,
  type TrendSourceResult,
} from './types.js';

type FeedEntry = Record<string, unknown>;

const primitive = (current: unknown): string => {
  if (typeof current === 'string' || typeof current === 'number') {
    return String(current);
  }
  if (Array.isArray(current)) {
    const candidates: unknown[] = current;
    const preferred = candidates.find(
      (candidate) =>
        candidate &&
        typeof candidate === 'object' &&
        ((candidate as Record<string, unknown>)['@_rel'] === 'alternate' ||
          (candidate as Record<string, unknown>)['@_rel'] === undefined),
    );
    return primitive(preferred ?? candidates[0]);
  }
  if (current && typeof current === 'object') {
    const record = current as Record<string, unknown>;
    return primitive(
      record['#text'] ?? record['@_href'] ?? record.name ?? record.email,
    );
  }
  return '';
};

const values = (current: unknown): string[] => {
  if (Array.isArray(current)) {
    return current.flatMap(values);
  }
  if (current && typeof current === 'object') {
    const record = current as Record<string, unknown>;
    return values(record['#text'] ?? record['@_term'] ?? record.name);
  }
  const value = safeExternalExcerpt(primitive(current));
  return value ? [value] : [];
};

const field = (entry: FeedEntry, ...names: string[]): string => {
  for (const name of names) {
    const current = primitive(entry[name]);
    if (current.trim()) {
      return current;
    }
  }
  return '';
};

const entryUrl = (entry: FeedEntry, feedUrl: string): string | undefined => {
  const raw = field(entry, 'link', 'url');
  if (!raw) {
    return undefined;
  }
  try {
    return assertPublicHttpUrl(new URL(raw, feedUrl).toString()).toString();
  } catch {
    return undefined;
  }
};

const parsedDate = (value: string): Date | undefined => {
  if (!value) {
    return undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp);
};

export const parseTrendFeed = (input: {
  xml: string;
  feedUrl: string;
  now: Date;
  maxItems: number;
}): TrendSignal[] => {
  const parsed = new XMLParser({
    ignoreAttributes: false,
    processEntities: false,
  }).parse(input.xml) as Record<string, unknown>;
  const rss = parsed.rss as
    | { channel?: { item?: FeedEntry | FeedEntry[]; title?: unknown } }
    | undefined;
  const atom = parsed.feed as
    { entry?: FeedEntry | FeedEntry[]; title?: unknown } | undefined;
  const rdf = parsed['rdf:RDF'] as
    { item?: FeedEntry | FeedEntry[] } | undefined;
  const rawEntries = rss?.channel?.item ?? atom?.entry ?? rdf?.item ?? [];
  const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];
  const feedName = safeExternalExcerpt(
    primitive(rss?.channel?.title ?? atom?.title),
  );
  const unique = new Map<string, TrendSignal>();
  for (const entry of entries.slice(0, input.maxItems)) {
    const title = safeExternalExcerpt(field(entry, 'title'));
    if (!title || title.length < 2) {
      continue;
    }
    const url = entryUrl(entry, input.feedUrl);
    const stableId = field(entry, 'guid', 'id') || url;
    if (!stableId) {
      continue;
    }
    const canonicalUrl = url ?? input.feedUrl;
    const description = safeExternalExcerpt(
      field(entry, 'description', 'summary', 'content:encoded', 'content'),
    );
    const author = safeExternalExcerpt(
      field(entry, 'author', 'dc:creator', 'creator'),
    );
    const publishedAt = parsedDate(
      field(entry, 'pubDate', 'published', 'updated', 'dc:date'),
    );
    const keywords = [
      ...new Set([...values(entry.category), ...values(entry['dc:subject'])]),
    ].slice(0, 50);
    const signal = trendSignalSchema.parse({
      externalId: stableId,
      source: 'RSS',
      sourceUrl: canonicalUrl,
      title: title.slice(0, 500),
      ...(description ? { description } : {}),
      ...(author ? { author } : {}),
      keywords,
      region: 'GLOBAL',
      ...(publishedAt ? { publishedAt } : {}),
      collectedAt: input.now,
      metrics: {},
      metadata: {
        feedUrl: input.feedUrl,
        feedName,
        stableId,
      },
    });
    unique.set(canonicalTrendUrl(canonicalUrl), signal);
  }
  return [...unique.values()];
};

type FeedCache = {
  etag?: string;
  lastModified?: string;
  signals: TrendSignal[];
};

export class RssTrendSource implements TrendSource {
  public readonly id = 'RSS' as const;
  public readonly name = 'RSS / Atom feeds';
  public readonly enabled: boolean;
  readonly #cache = new Map<string, FeedCache>();

  public constructor(
    private readonly options: TrendHttpOptions & {
      feeds?: readonly string[];
      maxItemsPerFeed?: number;
      resolvePublicUrl?: typeof assertPublicHttpUrlResolved;
    } = {},
  ) {
    this.enabled = (options.feeds ?? []).length > 0;
  }

  async #collectFeed(feedUrl: string, now: Date): Promise<TrendSignal[]> {
    const resolvePublicUrl =
      this.options.resolvePublicUrl ?? assertPublicHttpUrlResolved;
    const cached = this.#cache.get(feedUrl);
    let url = await resolvePublicUrl(feedUrl);
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      const response = await fetchWithTrendRetry(
        url,
        {
          redirect: 'manual',
          headers: {
            accept:
              'application/atom+xml, application/rss+xml, application/xml, text/xml',
            'user-agent': 'Watcher-Socials-Bot/1.0',
            ...(cached?.etag ? { 'if-none-match': cached.etag } : {}),
            ...(cached?.lastModified
              ? { 'if-modified-since': cached.lastModified }
              : {}),
          },
        },
        {
          ...this.options,
          acceptableStatus: (status) =>
            status === 304 || (status >= 300 && status < 400),
        },
      );
      if (response.status === 304) {
        if (!cached) {
          throw new Error('Feed returned 304 before it had been cached');
        }
        return cached.signals.map((signal) => ({
          ...signal,
          collectedAt: now,
        }));
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          throw new Error('Feed redirect omitted its destination');
        }
        url = await resolvePublicUrl(new URL(location, url).toString());
        continue;
      }
      const xml = await response.text();
      if (xml.length > 5_000_000) {
        throw new Error('Feed exceeded the 5 MB response limit');
      }
      const signals = parseTrendFeed({
        xml,
        feedUrl,
        now,
        maxItems: Math.max(
          1,
          Math.min(this.options.maxItemsPerFeed ?? 30, 100),
        ),
      });
      this.#cache.set(feedUrl, {
        ...(response.headers.get('etag')
          ? { etag: response.headers.get('etag')! }
          : {}),
        ...(response.headers.get('last-modified')
          ? { lastModified: response.headers.get('last-modified')! }
          : {}),
        signals,
      });
      return signals;
    }
    throw new Error('Feed exceeded the redirect limit');
  }

  public async collect(
    context: TrendSourceContext,
  ): Promise<TrendSourceResult> {
    const feeds = this.options.feeds ?? [];
    if (!this.enabled) {
      return {
        source: this.id,
        availability: 'DISABLED',
        signals: [],
        quotaUsed: 0,
        error: 'No RSS or Atom feeds are configured',
      };
    }
    const settled = await Promise.allSettled(
      feeds.map((feed) => this.#collectFeed(feed, context.now)),
    );
    const unique = new Map<string, TrendSignal>();
    for (const result of settled) {
      if (result.status !== 'fulfilled') {
        continue;
      }
      for (const signal of result.value) {
        unique.set(canonicalTrendUrl(signal.sourceUrl), signal);
      }
    }
    const failures = settled.filter(
      (result) => result.status === 'rejected',
    ).length;
    return {
      source: this.id,
      availability: failures === settled.length ? 'ERROR' : 'ACTIVE',
      signals: [...unique.values()],
      quotaUsed: settled.length - failures,
      ...(failures > 0
        ? {
            error: `${failures}/${settled.length} RSS/Atom feeds failed; valid feeds were retained.`,
          }
        : {}),
    };
  }
}
