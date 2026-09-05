import type { Source, WatchItem } from '@watcher/core';
import { fetchText } from './http.js';

export class StooqPriceSource implements Source<{ symbol: string }> {
  public readonly id = 'PRICE';
  public readonly capabilities = {
    sourceName: 'Stooq',
    sourceType: 'MARKET_DATA' as const,
    minimumIntervalMs: 60_000,
    preferredIntervalMs: 5 * 60_000,
    maximumIntervalMs: 24 * 60 * 60_000,
    supportsStreaming: false,
    costPerRequestUsd: 0,
    rateLimitPerMinute: null,
    priority: 70,
  };
  public constructor(private readonly fetcher: typeof fetch = fetch) {}

  public async fetch(
    config: { symbol: string },
    signal?: AbortSignal,
  ): Promise<WatchItem[]> {
    const symbol = `${config.symbol.toLowerCase()}.us`;
    let csv: string;
    try {
      csv = await fetchText(
        this.fetcher,
        `https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2ohlcv&h&e=csv`,
        { accept: 'text/csv' },
        signal,
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'HTTP 404 from stooq.com')
        return [];
      throw error;
    }
    const [header, row] = csv.trim().split('\n');
    if (!header || !row || row.includes('N/D')) return [];
    const fields = row.split(',');
    const [ticker, date, time, open, high, low, close, volume] = fields;
    if (!ticker || !date || !close) return [];
    const externalId = `${config.symbol}:${date}:${time ?? ''}`;
    return [
      {
        id: `PRICE:${externalId}`,
        source: this.id,
        externalId,
        title: `${config.symbol} market price ${close}`,
        url: `https://stooq.com/q/?s=${encodeURIComponent(symbol)}`,
        publishedAt: new Date(`${date}T${time ?? '00:00:00'}Z`),
        content: `Open ${open}; high ${high}; low ${low}; close ${close}; volume ${volume}.`,
        sourceType: 'MARKET_DATA',
        primarySource: false,
        eventAt: new Date(`${date}T${time ?? '00:00:00'}Z`),
        category: 'PRICE_SNAPSHOT',
        normalizedFacts: { open, high, low, close, volume },
        entities: [config.symbol.toUpperCase()],
        reliability: 0.7,
        metadata: { symbol: config.symbol, open, high, low, close, volume },
      },
    ];
  }
}
