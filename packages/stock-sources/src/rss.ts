import {
  assertPublicHttpUrl,
  type Source,
  type WatchItem,
} from '@watcher/core';
import { XMLParser } from 'fast-xml-parser';
import { fetchPublicText, stripHtml } from './http.js';

type FeedConfig = { symbol: string; feedUrl: string; maxItems?: number };
type FeedEntry = Record<string, unknown>;

const value = (entry: FeedEntry, key: string): string => {
  const current = entry[key];
  if (typeof current === 'string') return current;
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
  public constructor(
    public readonly id: 'INVESTOR_RELATIONS' | 'NEWS',
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  public async fetch(
    config: FeedConfig,
    signal?: AbortSignal,
  ): Promise<WatchItem[]> {
    const xml = await fetchPublicText(this.fetcher, config.feedUrl, signal);
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
      if (!title || !link || !externalId || !content) return [];
      return [
        {
          id: `${this.id}:${externalId}`,
          source: this.id,
          externalId,
          title,
          url: assertPublicHttpUrl(link).toString(),
          publishedAt: new Date(
            value(entry, 'pubDate') || value(entry, 'updated') || Date.now(),
          ),
          content: stripHtml(content),
          metadata: { symbol: config.symbol },
        },
      ];
    });
  }
}
