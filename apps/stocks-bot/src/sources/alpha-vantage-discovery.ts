import type {
  DiscoveryScanMode,
  MarketDiscoveryObservation,
  MarketDiscoveryScanner,
} from '../core/index.js';
import { finiteNumber } from '@watcher/core';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { fetchText } from './http.js';

const moverSchema = z.object({
  ticker: z.string().trim().min(1),
  price: z.string().trim().min(1),
  change_amount: z.string().trim().optional(),
  change_percentage: z.string().trim().min(1),
  volume: z.string().trim().min(1),
});

const responseSchema = z.object({
  metadata: z.string().optional(),
  last_updated: z.string().optional(),
  top_gainers: z.array(moverSchema).optional().default([]),
  top_losers: z.array(moverSchema).optional().default([]),
  most_actively_traded: z.array(moverSchema).optional().default([]),
  Note: z.string().optional(),
  Information: z.string().optional(),
  'Error Message': z.string().optional(),
});

export type AlphaVantageEntitlement = 'EOD' | 'DELAYED' | 'REALTIME';

export class AlphaVantageDiscoveryScanner implements MarketDiscoveryScanner {
  public readonly id = 'ALPHA_VANTAGE_MARKET_MOVERS';

  public constructor(
    private readonly apiKey: string,
    private readonly entitlement: AlphaVantageEntitlement = 'EOD',
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!apiKey.trim()) {
      throw new Error('ALPHA_VANTAGE_API_KEY is required');
    }
  }

  public async scan(
    mode: DiscoveryScanMode,
    signal?: AbortSignal,
  ): Promise<MarketDiscoveryObservation[]> {
    const url = new URL('https://www.alphavantage.co/query');
    url.searchParams.set('function', 'TOP_GAINERS_LOSERS');
    url.searchParams.set('apikey', this.apiKey);
    if (mode === 'INTRADAY' && this.entitlement !== 'EOD') {
      url.searchParams.set('entitlement', this.entitlement.toLowerCase());
    }
    const rawResponse = await fetchText(
      this.fetcher,
      url.toString(),
      {},
      signal,
    );
    const parsed = responseSchema.parse(JSON.parse(rawResponse));
    const providerError =
      parsed['Error Message'] ?? parsed.Note ?? parsed.Information;
    if (
      providerError &&
      parsed.top_gainers.length === 0 &&
      parsed.top_losers.length === 0 &&
      parsed.most_actively_traded.length === 0
    ) {
      throw new Error(`Alpha Vantage unavailable: ${providerError}`);
    }
    const observedAt = this.now();
    const snapshotId =
      parsed.last_updated ??
      createHash('sha256').update(rawResponse).digest('hex');
    const normalize = (
      mover: z.infer<typeof moverSchema>,
      trigger: 'PRICE_MOVE' | 'MOST_ACTIVE',
    ): MarketDiscoveryObservation | null => {
      const price = finiteNumber(mover.price);
      const changePercent = finiteNumber(mover.change_percentage);
      const volume = finiteNumber(mover.volume);
      if (
        price === null ||
        price <= 0 ||
        changePercent === null ||
        volume === null ||
        volume < 0
      ) {
        return null;
      }
      return {
        ticker: mover.ticker.toUpperCase(),
        price,
        changePercent,
        volume: Math.round(volume),
        observedAt,
        snapshotId,
        source: this.id,
        trigger,
      };
    };
    return [
      ...parsed.top_gainers.map((mover) => normalize(mover, 'PRICE_MOVE')),
      ...parsed.top_losers.map((mover) => normalize(mover, 'PRICE_MOVE')),
      ...parsed.most_actively_traded.map((mover) =>
        normalize(mover, 'MOST_ACTIVE'),
      ),
    ].filter((entry): entry is MarketDiscoveryObservation => entry !== null);
  }
}
