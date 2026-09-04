import type { Source, WatchItem } from '@watcher/core';
import { fetchText } from './http.js';

export class StooqPriceSource implements Source<{ symbol: string }> {
  public readonly id = 'PRICE';
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
        metadata: { symbol: config.symbol, open, high, low, close, volume },
      },
    ];
  }
}
