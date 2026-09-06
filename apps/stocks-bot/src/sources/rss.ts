import { parseDate, type Source, type WatchItem } from '@watcher/core';
import { XMLParser } from 'fast-xml-parser';
import { fetchPublicText, stripHtml } from './utils/http.js';
import {
  assertPublicHttpUrl,
  assertPublicHttpUrlResolved,
} from './utils/network.js';

type FeedConfig = { symbol: string; feedUrl: string; maxItems?: number };
type FeedEntry = Record<string, unknown>;

const value = (entry: FeedEntry, key: string): string => {
  const current = entry[key];
  if (typeof current === 'string') {
    return current;
  }
  if (current && typeof current === 'object') {
    const record = current as Record<string, unknown>;
    const nested = record['#text'] ?? record['@_href'];
    return typeof nested === 'string' || typeof nested === 'number'
      ? String(nested)
      : '';
  }
  return '';
};

export class RssStockSource implements Source<FeedConfig> {
  public readonly capabilities;
  public constructor(
    public readonly id: 'INVESTOR_RELATIONS' | 'NEWS',
    private readonly fetcher: typeof fetch = fetch,
    private readonly resolvePublicUrl: typeof assertPublicHttpUrlResolved = assertPublicHttpUrlResolved,
  ) {
    this.capabilities = {
      sourceName: id === 'INVESTOR_RELATIONS' ? 'Investor Relations' : 'News',
      sourceType: id,
      minimumIntervalMs: 60_000,
      preferredIntervalMs: 5 * 60_000,
      maximumIntervalMs: 30 * 60_000,
      supportsStreaming: false,
      costPerRequestUsd: 0,
      rateLimitPerMinute: null,
      priority: id === 'INVESTOR_RELATIONS' ? 95 : 75,
    } as const;
  }

  public async fetch(
    config: FeedConfig,
    signal?: AbortSignal,
  ): Promise<WatchItem[]> {
    const xml = await fetchPublicText(
      this.fetcher,
      config.feedUrl,
      signal,
      this.resolvePublicUrl,
    );
    const parsed = new XMLParser({ ignoreAttributes: false }).parse(
      xml,
    ) as Record<string, unknown>;
    const rss = parsed.rss as
      { channel?: { item?: FeedEntry | FeedEntry[] } } | undefined;
    const feed = parsed.feed as { entry?: FeedEntry | FeedEntry[] } | undefined;
    const raw = rss?.channel?.item ?? feed?.entry ?? [];
    const entries = Array.isArray(raw) ? raw : [raw];
    return entries.slice(0, config.maxItems ?? 10).flatMap((entry) => {
      const title = value(entry, 'title');
      const link = value(entry, 'link');
      const externalId = value(entry, 'guid') || value(entry, 'id') || link;
      const content =
        value(entry, 'description') ||
        value(entry, 'summary') ||
        value(entry, 'content');
      if (!title || !link || !externalId || !content) {
        return [];
      }
      const publishedValue = value(entry, 'pubDate') || value(entry, 'updated');
      const publishedAt = parseDate(publishedValue);
      return [
        {
          id: `${this.id}:${externalId}`,
          source: this.id,
          externalId,
          title,
          url: assertPublicHttpUrl(link).toString(),
          ...(publishedAt ? { publishedAt, eventAt: publishedAt } : {}),
          content: stripHtml(content),
          sourceType: this.id,
          primarySource: this.id === 'INVESTOR_RELATIONS',
          category: this.id === 'NEWS' ? 'NEWS' : 'COMPANY_ANNOUNCEMENT',
          entities: [config.symbol.toUpperCase()],
          reliability: this.id === 'INVESTOR_RELATIONS' ? 0.95 : 0.7,
          metadata: { symbol: config.symbol },
        },
      ];
    });
  }
}
