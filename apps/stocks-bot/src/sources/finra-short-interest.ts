import { finiteNumber, type Source, type WatchItem } from '@watcher/core';
import { z } from 'zod';

export type FinraShortInterestConfig = { symbol: string; maxItems?: number };

const numeric = z.union([z.string(), z.number()]).nullish();
const rowSchema = z
  .object({
    symbolCode: z.string().min(1),
    issueName: z.string().nullish(),
    currentShortPositionQuantity: numeric,
    previousShortPositionQuantity: numeric,
    changePreviousNumber: numeric,
    changePercent: numeric,
    averageDailyVolumeQuantity: numeric,
    daysToCoverQuantity: numeric,
    settlementDate: z.string().min(1),
  })
  .loose();
const responseSchema = z.array(rowSchema);

export class FinraShortInterestSource implements Source<FinraShortInterestConfig> {
  public readonly id = 'FINRA_SHORT_INTEREST';
  public readonly capabilities = {
    sourceName: 'FINRA consolidated short interest',
    sourceType: 'REGULATORY' as const,
    minimumIntervalMs: 6 * 60 * 60_000,
    preferredIntervalMs: 24 * 60 * 60_000,
    maximumIntervalMs: 14 * 24 * 60 * 60_000,
    supportsStreaming: false,
    costPerRequestUsd: 0,
    rateLimitPerMinute: null,
    priority: 90,
  };

  public constructor(private readonly fetcher: typeof fetch = fetch) {}

  public async fetch(
    config: FinraShortInterestConfig,
    signal?: AbortSignal,
  ): Promise<WatchItem[]> {
    const symbol = config.symbol.trim().toUpperCase();
    const limit = Math.max(1, Math.min(config.maxItems ?? 4, 20));
    const response = await this.fetcher(
      'https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest',
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          compareFilters: [
            {
              compareType: 'EQUAL',
              fieldName: 'symbolCode',
              fieldValue: symbol,
            },
          ],
          limit,
          sortFields: ['-settlementDate'],
        }),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
          : AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok)
      throw new Error(`HTTP ${response.status} from api.finra.org`);
    return responseSchema
      .parse(await response.json())
      .slice(0, limit)
      .map((row) => {
        const settlementAt = new Date(
          `${row.settlementDate.slice(0, 10)}T00:00:00Z`,
        );
        const currentShortPosition =
          finiteNumber(row.currentShortPositionQuantity) ?? 0;
        const previousShortPosition = finiteNumber(
          row.previousShortPositionQuantity,
        );
        const changeShares = finiteNumber(row.changePreviousNumber);
        const changePercent = finiteNumber(row.changePercent);
        const averageDailyVolume = finiteNumber(row.averageDailyVolumeQuantity);
        const daysToCover = finiteNumber(row.daysToCoverQuantity);
        const externalId = `${symbol}:${row.settlementDate.slice(0, 10)}`;
        return {
          id: `${this.id}:${externalId}`,
          source: this.id,
          externalId,
          title: `${symbol} FINRA short interest ${row.settlementDate.slice(0, 10)}`,
          url: 'https://www.finra.org/finra-data/browse-catalog/equity-short-interest/data',
          publishedAt: settlementAt,
          eventAt: settlementAt,
          content: `Reported short position: ${currentShortPosition}. Previous: ${previousShortPosition ?? 'n/a'}. Change: ${changePercent ?? 'n/a'}%. Average daily volume: ${averageDailyVolume ?? 'n/a'}. Days to cover: ${daysToCover ?? 'n/a'}.`,
          sourceType: 'REGULATORY' as const,
          primarySource: true,
          category: 'SHORT_INTEREST_SNAPSHOT',
          normalizedFacts: {
            issueName: row.issueName,
            currentShortPosition,
            previousShortPosition,
            changeShares,
            changePercent,
            averageDailyVolume,
            daysToCover,
            settlementDate: row.settlementDate,
          },
          entities: [symbol, ...(row.issueName ? [row.issueName] : [])],
          reliability: 0.95,
          metadata: { symbol, provider: 'FINRA' },
        };
      });
  }
}
