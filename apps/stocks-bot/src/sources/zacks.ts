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

export type ZacksSnapshot = {
  symbol: string;
  companyName: string;
  rank: '1' | '2' | '3' | '4' | '5' | null;
  rankText: 'Strong Buy' | 'Buy' | 'Hold' | 'Sell' | 'Strong Sell' | null;
  price: string;
  forwardPe: string | null;
  updated: string;
  netChange: string;
  percentNetChange: string;
  marketStatus: string | null;
  confirmedEarningsDate: string | null;
};

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
    const snapshot = await this.getSnapshot(symbol, signal);
    if (!snapshot?.rank || !snapshot.rankText) return [];
    const rank = `${snapshot.rank}-${snapshot.rankText}`;
    const content = [
      `Ticker: ${snapshot.symbol}`,
      `Company: ${snapshot.companyName}`,
      `Zacks Rank: ${rank}`,
      `Price: ${snapshot.price} USD`,
      `Change: ${snapshot.netChange} (${snapshot.percentNetChange}%)`,
      `Updated: ${snapshot.updated} ET`,
      `Market status: ${available(snapshot.marketStatus ?? undefined)}`,
      `Forward P/E: ${snapshot.forwardPe ?? 'not available'}`,
      `Confirmed earnings date: ${available(snapshot.confirmedEarningsDate ?? undefined)}`,
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
          rank: snapshot.rank,
          rankText: snapshot.rankText,
          price: snapshot.price,
          forwardPe: snapshot.forwardPe ?? undefined,
          confirmedEarningsDate: snapshot.confirmedEarningsDate ?? undefined,
        },
        entities: [symbol, snapshot.companyName],
        reliability: 0.65,
        metadata: {
          symbol,
          companyName: snapshot.companyName,
          rank: snapshot.rank,
          rankText: snapshot.rankText,
          price: snapshot.price,
          netChange: snapshot.netChange,
          percentNetChange: snapshot.percentNetChange,
          updated: snapshot.updated,
          marketStatus: snapshot.marketStatus,
          forwardPe: snapshot.forwardPe,
          confirmedEarningsDate: snapshot.confirmedEarningsDate,
        },
      },
    ];
  }

  public async getSnapshot(
    symbol: string,
    signal?: AbortSignal,
  ): Promise<ZacksSnapshot | null> {
    const normalized = symbol.trim().toUpperCase();
    const text = await fetchText(
      this.fetcher,
      `https://quote-feed.zacks.com/index.php?t=${encodeURIComponent(normalized)}`,
      { accept: 'application/json' },
      signal,
    );
    const response = quoteResponseSchema.parse(JSON.parse(text));
    const quote = response[normalized];
    if (!quote) throw new Error(`Zacks quote was not found for ${normalized}`);
    return {
      symbol: normalized,
      companyName: quote.name,
      rank: quote.zacks_rank,
      rankText: quote.zacks_rank_text,
      price: quote.last,
      forwardPe: quote.pe_f1 && quote.pe_f1 !== 'NULL' ? quote.pe_f1 : null,
      updated: quote.updated,
      netChange: quote.net_change,
      percentNetChange: quote.percent_net_change,
      marketStatus:
        quote.market_status && quote.market_status !== 'NULL'
          ? quote.market_status
          : null,
      confirmedEarningsDate:
        quote.confirmed_reporting_date &&
        quote.confirmed_reporting_date !== 'NULL'
          ? quote.confirmed_reporting_date
          : null,
    };
  }
}
