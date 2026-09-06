import type { Source, WatchItem } from '@watcher/core';
import { fetchPublicText, htmlAttribute } from './utils/http.js';
import { assertPublicHttpUrlResolved } from './utils/network.js';
import { RssStockSource } from './rss.js';

export type InvestorRelationsConfig = {
  symbol: string;
  investorRelationsUrl?: string | null;
  maxItems?: number;
};

const discoverFeedUrl = async (
  pageUrl: string,
  html: string,
  resolvePublicUrl: typeof assertPublicHttpUrlResolved,
): Promise<string | undefined> => {
  if (/^\s*<(?:\?xml|rss\b|feed\b)/i.test(html)) {
    return (await resolvePublicUrl(pageUrl)).toString();
  }
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = htmlAttribute(tag, 'rel')?.toLowerCase() ?? '';
    const type = htmlAttribute(tag, 'type')?.toLowerCase() ?? '';
    const href = htmlAttribute(tag, 'href');
    if (
      href &&
      rel.split(/\s+/).includes('alternate') &&
      (type.includes('rss') || type.includes('atom'))
    ) {
      return (
        await resolvePublicUrl(new URL(href, pageUrl).toString())
      ).toString();
    }
  }
  return undefined;
};

export class InvestorRelationsSource implements Source<InvestorRelationsConfig> {
  public readonly id = 'INVESTOR_RELATIONS';
  public readonly capabilities = {
    sourceName: 'Investor Relations',
    sourceType: 'INVESTOR_RELATIONS' as const,
    minimumIntervalMs: 60_000,
    preferredIntervalMs: 5 * 60_000,
    maximumIntervalMs: 30 * 60_000,
    supportsStreaming: false,
    costPerRequestUsd: 0,
    rateLimitPerMinute: null,
    priority: 95,
  };
  readonly #feeds = new Map<string, string | null>();
  readonly #rss: RssStockSource;

  public constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly resolvePublicUrl: typeof assertPublicHttpUrlResolved = assertPublicHttpUrlResolved,
  ) {
    this.#rss = new RssStockSource(
      'INVESTOR_RELATIONS',
      fetcher,
      resolvePublicUrl,
    );
  }

  public async fetch(
    config: InvestorRelationsConfig,
    signal?: AbortSignal,
  ): Promise<WatchItem[]> {
    const pageUrl = config.investorRelationsUrl?.trim();
    if (!pageUrl) {
      return [];
    }
    let feedUrl = this.#feeds.get(pageUrl);
    if (feedUrl === undefined) {
      const html = await fetchPublicText(
        this.fetcher,
        pageUrl,
        signal,
        this.resolvePublicUrl,
      );
      feedUrl =
        (await discoverFeedUrl(pageUrl, html, this.resolvePublicUrl)) ?? null;
      this.#feeds.set(pageUrl, feedUrl);
    }
    if (!feedUrl) {
      return [];
    }
    return this.#rss.fetch(
      {
        symbol: config.symbol,
        feedUrl,
        ...(config.maxItems === undefined ? {} : { maxItems: config.maxItems }),
      },
      signal,
    );
  }
}
