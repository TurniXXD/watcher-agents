import { parseDate, type Source, type WatchItem } from '@watcher/core';
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { companyMention } from './company-mention.js';
import { fetchText, stripHtml } from './utils/http.js';

export type OfficialAgencyNewsConfig = {
  symbol: string;
  companyName?: string | null;
  maxItems?: number;
};

export type OfficialAgencyNewsId = 'FTC' | 'DOJ';

const agencyFeeds: Record<
  OfficialAgencyNewsId,
  { name: string; url: string; host: string }
> = {
  FTC: {
    name: 'FTC competition press releases',
    url: 'https://www.ftc.gov/feeds/press-release-competition.xml',
    host: 'ftc.gov',
  },
  DOJ: {
    name: 'DOJ Antitrust Division press releases',
    url: 'https://www.justice.gov/news/rss?field_component=376&require_all=0&search_api_language=en&show_public_archived=0&type%5B0%5D=image_gallery&type%5B1%5D=press_release&type%5B2%5D=speech&type%5B3%5D=youtube_video',
    host: 'justice.gov',
  },
};

const recordSchema = z.record(z.string(), z.unknown());
type FeedEntry = z.infer<typeof recordSchema>;

const field = (entry: FeedEntry, key: string): string => {
  const raw = entry[key];
  if (typeof raw === 'string' || typeof raw === 'number') return String(raw);
  if (raw && typeof raw === 'object') {
    const nested = recordSchema.safeParse(raw);
    if (nested.success) {
      const value = nested.data['#text'] ?? nested.data['@_href'];
      if (typeof value === 'string' || typeof value === 'number') {
        return String(value);
      }
    }
  }
  return '';
};

const entriesFrom = (xml: string): FeedEntry[] => {
  const parsed = recordSchema.parse(
    new XMLParser({ ignoreAttributes: false }).parse(xml),
  );
  const rss = recordSchema.safeParse(parsed.rss);
  const channel = recordSchema.safeParse(rss.success ? rss.data.channel : null);
  const atom = recordSchema.safeParse(parsed.feed);
  const raw = channel.success
    ? channel.data.item
    : atom.success
      ? atom.data.entry
      : null;
  const entries = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return entries.flatMap((entry) => {
    const result = recordSchema.safeParse(entry);
    return result.success ? [result.data] : [];
  });
};

export class OfficialAgencyNewsSource implements Source<OfficialAgencyNewsConfig> {
  public readonly capabilities;
  #feedCache: { expiresAt: number; entries: FeedEntry[] } | undefined;
  #feedLoad: Promise<FeedEntry[]> | undefined;

  public constructor(
    public readonly id: OfficialAgencyNewsId,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.capabilities = {
      sourceName: agencyFeeds[id].name,
      sourceType: 'REGULATORY' as const,
      minimumIntervalMs: 15 * 60_000,
      preferredIntervalMs: 60 * 60_000,
      maximumIntervalMs: 24 * 60 * 60_000,
      supportsStreaming: false,
      costPerRequestUsd: 0,
      rateLimitPerMinute: null,
      priority: 96,
    };
  }

  public async fetch(
    config: OfficialAgencyNewsConfig,
    signal?: AbortSignal,
  ): Promise<WatchItem[]> {
    const companyName = config.companyName?.trim();
    if (!companyName) return [];
    const symbol = config.symbol.trim().toUpperCase();
    const source = agencyFeeds[this.id];
    let entries = this.#feedCache?.entries;
    if (!entries || (this.#feedCache?.expiresAt ?? 0) <= Date.now()) {
      this.#feedLoad ??= fetchText(
        this.fetcher,
        source.url,
        {
          accept: 'application/rss+xml,application/atom+xml',
          'user-agent': 'Mozilla/5.0 (compatible; Watcher/1.0)',
        },
        signal,
      )
        .then((xml) => entriesFrom(xml))
        .then((loaded) => {
          this.#feedCache = {
            expiresAt: Date.now() + 15 * 60_000,
            entries: loaded,
          };
          return loaded;
        })
        .finally(() => {
          this.#feedLoad = undefined;
        });
      entries = await this.#feedLoad;
    }
    const maxItems = Math.max(1, Math.min(config.maxItems ?? 5, 10));
    return entries
      .flatMap((entry): WatchItem[] => {
        const title = stripHtml(field(entry, 'title'));
        const summary = stripHtml(
          field(entry, 'description') ||
            field(entry, 'summary') ||
            field(entry, 'content:encoded'),
        );
        if (!title || !companyMention(`${title} ${summary}`, companyName)) {
          return [];
        }
        const link = field(entry, 'link');
        let url: URL;
        try {
          url = new URL(link);
        } catch {
          return [];
        }
        if (
          url.protocol !== 'https:' ||
          (url.hostname !== source.host &&
            !url.hostname.endsWith(`.${source.host}`))
        ) {
          return [];
        }
        const externalId =
          field(entry, 'guid') || field(entry, 'id') || url.toString();
        const publishedAt = parseDate(
          field(entry, 'pubDate') ||
            field(entry, 'published') ||
            field(entry, 'updated') ||
            field(entry, 'dc:date'),
        );
        if (
          !publishedAt ||
          publishedAt.getTime() < Date.now() - 90 * 24 * 60 * 60_000
        ) {
          return [];
        }
        return [
          {
            id: `${this.id}:${externalId}`,
            source: this.id,
            externalId,
            title,
            url: url.toString(),
            publishedAt,
            eventAt: publishedAt,
            content: summary || title,
            sourceType: 'REGULATORY',
            primarySource: true,
            category: 'REGULATORY_ACTION',
            entities: [symbol, companyName],
            reliability: 0.95,
            metadata: { symbol, provider: source.name },
          },
        ];
      })
      .slice(0, maxItems);
  }
}
