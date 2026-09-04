import { createHash } from 'node:crypto';
import type { Source, WatchItem } from '@watcher/core';
import { z } from 'zod';
import { fetchText } from './http.js';

export type ZacksConfig = { symbol: string };

const quoteSchema = z.object({
  ticker: z.string().min(1),
  name: z.string().min(1),
  zacks_rank: z.string().regex(/^[1-5]$/),
  zacks_rank_text: z.enum(['Strong Buy', 'Buy', 'Hold', 'Sell', 'Strong Sell']),
  last: z.string().min(1),
  net_change: z.string().min(1),
  percent_net_change: z.string().min(1),
  updated: z.string().min(1),
  market_status: z.string().optional(),
  pe_f1: z.string().optional(),
  confirmed_reporting_date: z.string().optional(),
});
const quoteResponseSchema = z.record(z.string(), quoteSchema);

const available = (value: string | undefined): string =>
  value && value !== 'NULL' ? value : 'not available';

export class ZacksSource implements Source<ZacksConfig> {
  public readonly id = 'ZACKS';

  public constructor(private readonly fetcher: typeof fetch = fetch) {}

  public async fetch(
    config: ZacksConfig,
    signal?: AbortSignal,
  ): Promise<WatchItem[]> {
    const symbol = config.symbol.trim().toUpperCase();
    const pageUrl = `https://www.zacks.com/stock/quote/${encodeURIComponent(symbol)}`;
    const text = await fetchText(
      this.fetcher,
      `https://quote-feed.zacks.com/index.php?t=${encodeURIComponent(symbol)}`,
      { accept: 'application/json' },
      signal,
    );
    const response = quoteResponseSchema.parse(JSON.parse(text));
    const quote = response[symbol];
    if (!quote) throw new Error(`Zacks quote was not found for ${symbol}`);

    const rank = `${quote.zacks_rank}-${quote.zacks_rank_text}`;
    const content = [
      `Ticker: ${quote.ticker}`,
      `Company: ${quote.name}`,
      `Zacks Rank: ${rank}`,
      `Price: ${quote.last} USD`,
      `Change: ${quote.net_change} (${quote.percent_net_change}%)`,
      `Updated: ${quote.updated} ET`,
      `Market status: ${available(quote.market_status)}`,
      `Forward P/E: ${available(quote.pe_f1)}`,
      `Confirmed earnings date: ${available(quote.confirmed_reporting_date)}`,
    ].join('\n');
    const externalId = createHash('sha256').update(content).digest('hex');

    return [
      {
        id: `${this.id}:${externalId}`,
        source: this.id,
        externalId,
        title: `${symbol} Zacks ${rank}`,
        url: pageUrl,
        content,
        metadata: {
          symbol,
          companyName: quote.name,
          rank: quote.zacks_rank,
          rankText: quote.zacks_rank_text,
          price: quote.last,
          netChange: quote.net_change,
          percentNetChange: quote.percent_net_change,
          updated: quote.updated,
          marketStatus: quote.market_status,
          forwardPe: quote.pe_f1,
          confirmedEarningsDate: quote.confirmed_reporting_date,
        },
      },
    ];
  }
}
