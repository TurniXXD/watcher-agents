import type { Source, WatchItem } from '@watcher/core';
import { z } from 'zod';
import { fetchText } from './utils/http.js';

const headers = {
  accept: 'application/json',
  'user-agent': 'Watcher/1.0 (public-market-data)',
} as const;

const historySchema = z.object({
  data: z
    .object({
      symbol: z.string(),
      tradesTable: z.object({
        rows: z.array(
          z.object({
            date: z.string(),
            open: z.string(),
            high: z.string(),
            low: z.string(),
            close: z.string(),
            volume: z.string(),
          }),
        ),
      }),
    })
    .nullable(),
  status: z.object({ rCode: z.number() }),
});

const quoteSchema = z.object({
  data: z
    .object({
      symbol: z.string(),
      primaryData: z.object({ lastSalePrice: z.string() }),
    })
    .nullable(),
  status: z.object({ rCode: z.number() }),
});

const summarySchema = z.object({
  data: z
    .object({
      symbol: z.string(),
      summaryData: z.object({
        MarketCap: z.object({ value: z.string() }).optional(),
      }),
    })
    .nullable(),
  status: z.object({ rCode: z.number() }),
});

const numeric = (value: string): number | null => {
  const normalized = value.trim().replaceAll(',', '').replace(/^\$/u, '');
  if (!/^\d+(?:\.\d+)?$/u.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const tradingDate = (value: string): string | null => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(value);
  if (!match) return null;
  const [, month, day, year] = match;
  const iso = `${year}-${month}-${day}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === iso
    ? iso
    : null;
};

const quoteUrl = (symbol: string, section: 'info' | 'summary'): string =>
  `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/${section}?assetclass=stocks`;

const detailsUrl = (symbol: string): string =>
  `https://www.nasdaq.com/market-activity/stocks/${encodeURIComponent(symbol.toLowerCase())}`;

export class NasdaqPriceSource implements Source<{ symbol: string }> {
  public readonly id = 'PRICE';
  public readonly capabilities = {
    sourceName: 'Nasdaq',
    sourceType: 'MARKET_DATA' as const,
    minimumIntervalMs: 60_000,
    preferredIntervalMs: 5 * 60_000,
    maximumIntervalMs: 24 * 60 * 60_000,
    supportsStreaming: false,
    costPerRequestUsd: 0,
    rateLimitPerMinute: null,
    priority: 70,
    requestPolicy: {
      providerKey: 'nasdaq-public',
      maxConcurrency: 2,
      minimumSpacingMs: 250,
      sharedRateLimitBackoff: true,
    },
  };

  public constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async request<
    T extends { data: { symbol: string } | null; status: { rCode: number } },
  >(
    symbol: string,
    url: string,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<NonNullable<T['data']>> {
    const raw = await fetchText(this.fetcher, url, headers, signal);
    const parsed = schema.parse(JSON.parse(raw) as unknown);
    if (parsed.status.rCode !== 200 || !parsed.data) {
      throw new Error(`Nasdaq did not return market data for ${symbol}`);
    }
    if (parsed.data.symbol.toUpperCase() !== symbol.toUpperCase()) {
      throw new Error(`Nasdaq returned a different ticker for ${symbol}`);
    }
    return parsed.data;
  }

  public async fetch(
    config: { symbol: string },
    signal?: AbortSignal,
  ): Promise<WatchItem[]> {
    const symbol = config.symbol.trim().toUpperCase();
    const to = this.now();
    const from = new Date(to.getTime() - 14 * 86_400_000);
    const url = new URL(
      `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/historical`,
    );
    url.searchParams.set('assetclass', 'stocks');
    url.searchParams.set('fromdate', from.toISOString().slice(0, 10));
    url.searchParams.set('todate', to.toISOString().slice(0, 10));
    url.searchParams.set('limit', '10');
    const data = await this.request(
      symbol,
      url.toString(),
      historySchema,
      signal,
    );
    const rows = data.tradesTable.rows.flatMap((row) => {
      const date = tradingDate(row.date);
      const open = numeric(row.open);
      const high = numeric(row.high);
      const low = numeric(row.low);
      const close = numeric(row.close);
      const volume = numeric(row.volume);
      return date &&
        open !== null &&
        high !== null &&
        low !== null &&
        close !== null &&
        volume !== null &&
        open > 0 &&
        high > 0 &&
        low > 0 &&
        close > 0 &&
        volume >= 0
        ? [{ date, open, high, low, close, volume }]
        : [];
    });
    const latest = rows.sort((left, right) =>
      right.date.localeCompare(left.date),
    )[0];
    if (!latest) return [];
    const externalId = `${symbol}:${latest.date}`;
    return [
      {
        id: `PRICE:${externalId}`,
        source: this.id,
        externalId,
        title: `${symbol} Nasdaq daily close ${latest.close}`,
        url: detailsUrl(symbol),
        publishedAt: new Date(`${latest.date}T00:00:00Z`),
        content: `Nasdaq daily OHLCV for ${latest.date}: open ${latest.open}; high ${latest.high}; low ${latest.low}; close ${latest.close}; volume ${latest.volume}.`,
        sourceType: 'MARKET_DATA',
        primarySource: false,
        eventAt: new Date(`${latest.date}T00:00:00Z`),
        category: 'PRICE_SNAPSHOT',
        normalizedFacts: {
          open: latest.open,
          high: latest.high,
          low: latest.low,
          close: latest.close,
          volume: latest.volume,
        },
        entities: [symbol],
        reliability: 0.8,
        metadata: { symbol, ...latest, provider: 'Nasdaq daily historical' },
      },
    ];
  }

  public async getLatestQuote(
    symbol: string,
    signal?: AbortSignal,
  ): Promise<{ close: number; observedAt: Date; sourceUrl: string } | null> {
    const normalized = symbol.trim().toUpperCase();
    const data = await this.request(
      normalized,
      quoteUrl(normalized, 'info'),
      quoteSchema,
      signal,
    );
    const close = numeric(data.primaryData.lastSalePrice);
    return close !== null && close > 0
      ? { close, observedAt: this.now(), sourceUrl: detailsUrl(normalized) }
      : null;
  }

  public async getMarketCap(
    symbol: string,
    signal?: AbortSignal,
  ): Promise<number | null> {
    const normalized = symbol.trim().toUpperCase();
    const data = await this.request(
      normalized,
      quoteUrl(normalized, 'summary'),
      summarySchema,
      signal,
    );
    const value = data.summaryData.MarketCap?.value;
    const marketCap = value ? numeric(value) : null;
    return marketCap !== null && marketCap >= 0 ? marketCap : null;
  }
}
