import { describe, expect, it } from 'vitest';
import type { NormalizedObservation } from '@watcher/core';
import {
  catalystFromEvent,
  classifyInsiderTransaction,
  detectMarketAnomaly,
  marketAnomalyEvent,
  type CanonicalEventCandidate,
} from '../index.js';

const observation: NormalizedObservation = {
  id: 'PRICE:MU:2026-09-05',
  watcherKind: 'STOCKS',
  source: 'PRICE',
  sourceType: 'MARKET_DATA',
  sourceUrl: 'https://stooq.com/',
  primarySource: false,
  ticker: 'MU',
  publishedAt: new Date('2026-09-05T20:00:00Z'),
  discoveredAt: new Date('2026-09-05T20:01:00Z'),
  eventAt: new Date('2026-09-05T20:00:00Z'),
  category: 'PRICE_SNAPSHOT',
  headline: 'MU price snapshot',
  rawText: 'Market data',
  normalizedFacts: {},
  entities: ['MU'],
  reliability: 0.7,
  metadata: { symbol: 'MU' },
};

describe('specialized stock intelligence', () => {
  it('classifies planned and discretionary insider transactions conservatively', () => {
    expect(
      classifyInsiderTransaction({
        owner: 'Jane Doe',
        officerTitle: 'Chief Executive Officer',
        transactionCode: 'S',
        transactionDate: '2026-09-01',
        shares: 10_000,
        pricePerShare: 100,
        sharesOwnedFollowing: 90_000,
        footnotes: 'Sale under a Rule 10b5-1 trading plan.',
      }),
    ).toMatchObject({
      insider: 'Jane Doe',
      transactionType: '10B5_1_SALE',
      planned: true,
      discretionary: false,
      transactionValue: 1_000_000,
      holdingsBefore: 100_000,
      convictionScore: -1,
    });

    expect(
      classifyInsiderTransaction({
        owner: 'John Doe',
        role: 'CFO',
        transactionCode: 'P',
        shares: 20_000,
        price: 100,
        sharesOwnedFollowing: 120_000,
      }).convictionScore,
    ).toBe(5);
  });

  it('detects price, gap, volume, and volatility anomalies without assigning direction', () => {
    const history = Array.from({ length: 20 }, (_, index) => ({
      at: new Date(Date.UTC(2026, 7, index + 1)),
      open: 100,
      high: 101,
      low: 99,
      close: 100 + (index % 2) * 0.2,
      volume: 1_000,
    }));
    const anomaly = detectMarketAnomaly(
      {
        at: new Date('2026-09-05T20:00:00Z'),
        open: 106,
        high: 111,
        low: 105,
        close: 110,
        volume: 5_000,
        sectorReturnPercent: 1,
        indexReturnPercent: 0.5,
      },
      history,
    );

    expect(anomaly).toMatchObject({
      priceAnomaly: true,
      gapAnomaly: true,
      volumeAnomaly: true,
    });
    expect(anomaly?.relativeSectorPercent).toBeTypeOf('number');
    expect(anomaly?.relativeIndexPercent).toBeTypeOf('number');
    expect(marketAnomalyEvent(observation, anomaly!)).toMatchObject({
      eventType: 'PRICE_ANOMALY',
      direction: 'UNKNOWN',
      action: 'STATE_UPDATE',
      magnitude: { cause: 'UNKNOWN', unexplained: true },
    });
  });

  it('creates a dated persistent catalyst candidate', () => {
    const event: CanonicalEventCandidate = {
      ticker: 'MU',
      eventType: 'EARNINGS',
      title: 'MU earnings date',
      occurredAt: null,
      firstPublicAt: null,
      firstDetectedAt: new Date('2026-09-05T00:00:00Z'),
      direction: 'UNKNOWN',
      magnitude: {},
      surprise: 'UNKNOWN',
      materiality: 'HIGH',
      materialityScore: 80,
      materialityReasons: [],
      action: 'FULL_ANALYSIS',
      fingerprint: 'event',
      evidencePriority: 55,
    };
    const catalyst = catalystFromEvent(
      event,
      {
        ...observation,
        category: 'EARNINGS',
        normalizedFacts: { nextEarningsDate: '2026-09-10T20:00:00Z' },
      },
      new Date('2026-09-05T00:00:00Z'),
    );

    expect(catalyst).toMatchObject({
      catalystType: 'EARNINGS',
      exactDateKnown: true,
      proximity: 'HIGH',
      impact: 'HIGH',
      status: 'UPCOMING',
    });
  });
});
