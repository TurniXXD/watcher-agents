import type { DecisionResult } from '@watcher/core';
import type { StockDashboardEntry } from '@watcher/telegram';
import { describe, expect, it } from 'vitest';
import {
  parseStockAllocationRequest,
  rankStockAllocations,
  renderStockAllocation,
} from '../stock-allocation.js';

const decision = (
  recommendation: DecisionResult['recommendation'],
  expectedValuePercent: number | null,
  probabilityHigher: Partial<DecisionResult['probabilityHigher']> = {},
): DecisionResult => ({
  recommendation,
  expectedValuePercent,
  asymmetry: expectedValuePercent && expectedValuePercent > 5 ? 'GOOD' : 'FAIR',
  probabilityHigher: {
    sevenDays: { minimum: 48, maximum: 55 },
    thirtyDays: { minimum: 52, maximum: 62 },
    ninetyDays: { minimum: 56, maximum: 68 },
    twelveMonths: { minimum: 60, maximum: 75 },
    ...probabilityHigher,
  },
  scenarios: {
    bull: {
      probabilityPercent: { minimum: 20, maximum: 30 },
      expectedReturnPercent: { minimum: 15, maximum: 25 },
      assumptions: [],
      requiredCatalysts: [],
      invalidationConditions: [],
    },
    base: {
      probabilityPercent: { minimum: 45, maximum: 55 },
      expectedReturnPercent: { minimum: 0, maximum: 8 },
      assumptions: [],
      requiredCatalysts: [],
      invalidationConditions: [],
    },
    bear: {
      probabilityPercent: { minimum: 20, maximum: 30 },
      expectedReturnPercent: { minimum: -20, maximum: -10 },
      assumptions: [],
      requiredCatalysts: [],
      invalidationConditions: [],
    },
  },
  pricedIn: {
    classification: 'UNKNOWN',
    explanation: 'Incomplete expectations.',
  },
  maxRecommendedPositionPercent: { minimum: 0.5, maximum: 4 },
  rationale: [],
  humanReviewRequired: true,
});

const dashboard = (
  symbol: string,
  value: DecisionResult | null,
): StockDashboardEntry => ({
  stock: {
    symbol,
    companyName: null,
    monitoringTier: 'WATCH',
    monitoringMode: 'NORMAL',
    attentionScore: 50,
  },
  thesis: value
    ? {
        verdict: value.recommendation,
        confidence: 0.8,
        attentionScore: 50,
        netSignal: 2,
        insiderConviction: null,
        dataCoverage: 80,
        decision: value,
        updatedAt: new Date('2026-09-13T10:00:00Z'),
      }
    : null,
  price: null,
  catalyst: null,
  lastEvent: null,
  lastRevision: null,
});

describe('stock allocation research', () => {
  it('parses optional Czech-koruna and day flags in either order', () => {
    expect(
      parseStockAllocationRequest('--amount-czk 100000 --days 90'),
    ).toEqual({
      amountCzk: 100_000,
      days: 90,
    });
    expect(parseStockAllocationRequest('--days 7')).toEqual({ days: 7 });
    expect(parseStockAllocationRequest('')).toEqual({ days: 30 });
    expect(() => parseStockAllocationRequest('--days 30 --days 90')).toThrow(
      /Usage/,
    );
    expect(() => parseStockAllocationRequest('--days 366')).toThrow();
    expect(() => parseStockAllocationRequest('--amount-czk 10.5')).toThrow();
    expect(() => parseStockAllocationRequest('--currency eur')).toThrow(
      /Usage/,
    );
  });

  it('ranks model-eligible tickers and allocates the exact requested amount', () => {
    const ranked = rankStockAllocations(
      [
        dashboard('MU', decision('BUY', 12)),
        dashboard('NVO', decision('SMALL_POSITION', 6)),
        dashboard('AAPL', decision('WATCH', 20)),
        dashboard('NONE', null),
      ],
      { amountCzk: 100_000, days: 90 },
    );

    expect(ranked.map(({ symbol }) => symbol)).toEqual([
      'MU',
      'NVO',
      'AAPL',
      'NONE',
    ]);
    expect(
      ranked.find(({ symbol }) => symbol === 'MU')?.amountCzk,
    ).toBeGreaterThan(
      ranked.find(({ symbol }) => symbol === 'NVO')?.amountCzk ?? 0,
    );
    expect(ranked.reduce((sum, entry) => sum + (entry.amountCzk ?? 0), 0)).toBe(
      100_000,
    );
    expect(
      ranked.find(({ symbol }) => symbol === 'AAPL')?.amountCzk,
    ).toBeUndefined();
    expect(
      renderStockAllocation(ranked, { amountCzk: 100_000, days: 90 }),
    ).toContain('90d probability higher');
  });

  it('uses the selected horizon for ranking and allocation eligibility', () => {
    const shortTerm = decision('BUY', 12, {
      sevenDays: { minimum: 65, maximum: 75 },
      ninetyDays: { minimum: 45, maximum: 49 },
    });
    const longTerm = decision('BUY', 12, {
      sevenDays: { minimum: 45, maximum: 49 },
      ninetyDays: { minimum: 65, maximum: 75 },
    });

    const sevenDays = rankStockAllocations(
      [dashboard('SHORT', shortTerm), dashboard('LONG', longTerm)],
      { amountCzk: 10_000, days: 7 },
    );
    const ninetyDays = rankStockAllocations(
      [dashboard('SHORT', shortTerm), dashboard('LONG', longTerm)],
      { amountCzk: 10_000, days: 90 },
    );

    expect(sevenDays.map(({ symbol }) => symbol)).toEqual(['SHORT', 'LONG']);
    expect(sevenDays.find(({ symbol }) => symbol === 'SHORT')?.amountCzk).toBe(
      10_000,
    );
    expect(
      sevenDays.find(({ symbol }) => symbol === 'LONG')?.amountCzk,
    ).toBeUndefined();
    expect(ninetyDays.map(({ symbol }) => symbol)).toEqual(['LONG', 'SHORT']);
    expect(ninetyDays.find(({ symbol }) => symbol === 'LONG')?.amountCzk).toBe(
      10_000,
    );
  });

  it('keeps money unallocated without probability evidence for the horizon', () => {
    const ranked = rankStockAllocations(
      [
        dashboard(
          'MU',
          decision('BUY', 12, {
            twelveMonths: null,
          }),
        ),
      ],
      { amountCzk: 50_000, days: 365 },
    );

    expect(ranked[0]?.amountCzk).toBeUndefined();
    expect(
      renderStockAllocation(ranked, { amountCzk: 50_000, days: 365 }),
    ).toContain('Keep');
  });

  it('does not render zero-koruna positions for a tiny allocation', () => {
    const ranked = rankStockAllocations(
      [
        dashboard('MU', decision('BUY', 12)),
        dashboard('NVO', decision('BUY', 12)),
      ],
      { amountCzk: 1, days: 30 },
    );

    expect(
      ranked.filter(({ amountCzk }) => amountCzk !== undefined),
    ).toHaveLength(1);
    expect(ranked.reduce((sum, entry) => sum + (entry.amountCzk ?? 0), 0)).toBe(
      1,
    );
  });
});
