import { createHash } from 'node:crypto';
import type { Source, WatchItem } from '@watcher/core';
import { z } from 'zod';
import { fetchText } from './utils/http.js';

export type ZacksConfig = { symbol: string };

const zacksRankSchema = z.preprocess(
  (value) => (typeof value === 'number' ? String(value) : value),
  z.enum(['1', '2', '3', '4', '5']).nullable().catch(null),
);
const zacksRankTextSchema = z
  .enum(['Strong Buy', 'Buy', 'Hold', 'Sell', 'Strong Sell'])
  .nullable()
  .catch(null);

const quoteSchema = z.object({
  ticker: z.string().min(1),
  name: z.string().min(1),
  zacks_rank: zacksRankSchema,
  zacks_rank_text: zacksRankTextSchema,
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
  public readonly capabilities = {
    sourceName: 'Zacks',
    sourceType: 'ANALYST' as const,
    minimumIntervalMs: 15 * 60_000,
    preferredIntervalMs: 60 * 60_000,
    maximumIntervalMs: 24 * 60 * 60_000,
    supportsStreaming: false,
    costPerRequestUsd: 0,
    rateLimitPerMinute: null,
    priority: 55,
  };

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
    if (!quote.zacks_rank || !quote.zacks_rank_text) return [];

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
        sourceType: 'ANALYST',
        primarySource: false,
        category: 'ANALYST_SNAPSHOT',
        normalizedFacts: {
          rank: quote.zacks_rank,
          rankText: quote.zacks_rank_text,
          price: quote.last,
          forwardPe: quote.pe_f1,
          confirmedEarningsDate: quote.confirmed_reporting_date,
        },
        entities: [symbol, quote.name],
        reliability: 0.65,
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
