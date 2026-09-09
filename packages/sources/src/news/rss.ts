import {
  assertPublicHttpUrl,
  assertPublicHttpUrlResolved,
  parseDate,
  sourceHttpError,
  type Source,
  type WatchItem,
} from '@watcher/core';
import { XMLParser } from 'fast-xml-parser';
import type { NewsScope } from './catalog.js';

export type RssNewsConfig = {
  feedUrl: string;
  feedName: string;
  sourceKey?: string;
  scope: NewsScope;
  topics: string[];
  maxItems?: number;
};

type FeedEntry = Record<string, unknown>;

const normalizeWhitespace = (value: string): string =>
  value.replace(/\s+/gu, ' ').trim();

const stripHtml = (value: string): string =>
  normalizeWhitespace(
    value
      .replace(/<script[\s\S]*?<\/script>/giu, ' ')
      .replace(/<style[\s\S]*?<\/style>/giu, ' ')
      .replace(/<[^>]+>/gu, ' ')
      .replaceAll('&nbsp;', ' ')
      .replaceAll('&amp;', '&')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'"),
  );

const primitiveValue = (current: unknown): string => {
  if (typeof current === 'string' || typeof current === 'number')
    return String(current);
  if (Array.isArray(current)) {
    const candidates: unknown[] = current;
    const preferred = candidates.find(
      (candidate) =>
        candidate &&
        typeof candidate === 'object' &&
        ((candidate as Record<string, unknown>)['@_rel'] === 'alternate' ||
          (candidate as Record<string, unknown>)['@_rel'] === undefined),
    );
    return primitiveValue(preferred ?? candidates[0]);
  }
  if (current && typeof current === 'object') {
    const record = current as Record<string, unknown>;
    return primitiveValue(record['#text'] ?? record['@_href']);
  }
  return '';
};

const value = (entry: FeedEntry, key: string): string =>
  primitiveValue(entry[key]);

const entryLink = (entry: FeedEntry, feedUrl: string): string | undefined => {
  const raw = value(entry, 'link');
  if (!raw) return undefined;
  try {
    return assertPublicHttpUrl(new URL(raw, feedUrl).toString()).toString();
  } catch {
    return undefined;
  }
};

const fetchFeed = async (
  fetcher: typeof fetch,
  initialUrl: string,
  signal?: AbortSignal,
  resolvePublicUrl: typeof assertPublicHttpUrlResolved = assertPublicHttpUrlResolved,
): Promise<string> => {
  let url = await resolvePublicUrl(initialUrl);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetcher(url, {
      headers: {
        accept: 'application/atom+xml, application/rss+xml, application/xml',
        'user-agent': 'Watcher/1.0',
      },
      redirect: 'manual',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Feed redirect omitted its destination');
      url = await resolvePublicUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw sourceHttpError(response, url);
    return response.text();
  }
  throw new Error('Feed exceeded the redirect limit');
};

export class RssNewsSource implements Source<RssNewsConfig> {
  public readonly id = 'NEWS_RSS';
  public readonly capabilities = {
    sourceName: 'RSS/Atom news feeds',
    sourceType: 'NEWS',
    minimumIntervalMs: 10_000,
    preferredIntervalMs: 60_000,
    maximumIntervalMs: 15 * 60_000,
    supportsStreaming: false,
    costPerRequestUsd: 0,
    rateLimitPerMinute: 60,
    priority: 80,
    requestPolicy: {
      providerKey: 'NEWS_RSS',
      maxConcurrency: 4,
      minimumSpacingMs: 250,
      sharedRateLimitBackoff: false,
    },
  } as const;

  public constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly resolvePublicUrl: typeof assertPublicHttpUrlResolved = assertPublicHttpUrlResolved,
  ) {}

  public async fetch(
    config: RssNewsConfig,
    signal?: AbortSignal,
  ): Promise<WatchItem[]> {
    const xml = await fetchFeed(
      this.fetcher,
      config.feedUrl,
      signal,
      this.resolvePublicUrl,
    );
    const parsed = new XMLParser({
      ignoreAttributes: false,
      processEntities: false,
    }).parse(xml) as Record<string, unknown>;
    const rss = parsed.rss as
      { channel?: { item?: FeedEntry | FeedEntry[] } } | undefined;
    const atom = parsed.feed as { entry?: FeedEntry | FeedEntry[] } | undefined;
    const rdf = parsed['rdf:RDF'] as
      { item?: FeedEntry | FeedEntry[] } | undefined;
    const rawEntries = rss?.channel?.item ?? atom?.entry ?? rdf?.item ?? [];
    const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];

    return entries.slice(0, config.maxItems ?? 20).flatMap((entry) => {
      const title = stripHtml(value(entry, 'title'));
      const url = entryLink(entry, config.feedUrl);
      const description = stripHtml(
        value(entry, 'description') ||
          value(entry, 'summary') ||
          value(entry, 'content:encoded') ||
          value(entry, 'content'),
      );
      if (!title || !url) return [];
      const publishedAt = parseDate(
        value(entry, 'pubDate') ||
          value(entry, 'published') ||
          value(entry, 'updated'),
      );
      const source = `NEWS_RSS_${config.scope}`;
      return [
        {
          id: `${source}:${url}`,
          source,
          externalId: url,
          title,
          url,
          ...(publishedAt ? { publishedAt, eventAt: publishedAt } : {}),
          content: description || title,
          sourceType: 'NEWS',
          category: 'NEWS',
          reliability: 0.7,
          metadata: {
            scope: config.scope,
            topics: config.topics,
            feedName: config.feedName,
            feedUrl: config.feedUrl,
            ...(config.sourceKey ? { sourceKey: config.sourceKey } : {}),
          },
        },
      ];
    });
  }
}
