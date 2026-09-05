import type { DecisionInputs, StockThesisState } from '@watcher/core';
import { describe, expect, it } from 'vitest';
import { evaluateDecision } from '../decision.js';

const state = (
  overrides: Partial<StockThesisState> = {},
): StockThesisState => ({
  ticker: 'MU',
  thesis: 'Primary-source evidence supports improving earnings momentum.',
  verdict: 'WATCH',
  confidence: 0.8,
  attentionScore: 85,
  bullScore: 8,
  bearScore: 2,
  netSignal: 3,
  signalGroups: [],
  catalysts: [],
  insiderConviction: null,
  pricedIn: 'PARTIALLY_PRICED_IN',
  primaryDrivers: ['Earnings surprise'],
  risks: ['Demand durability'],
  dataCoverage: 90,
  dataQuality: 'HIGH',
  materialDataGaps: [],
  decision: null,
  ...overrides,
});

const inputs = (overrides: Partial<DecisionInputs> = {}): DecisionInputs => ({
  scenarios: {
    bull: {
      probabilityPercent: { minimum: 25, maximum: 35 },
      expectedReturnPercent: { minimum: 40, maximum: 60 },
      assumptions: ['Demand remains strong.'],
      requiredCatalysts: ['Guidance holds.'],
      invalidationConditions: ['Guidance is cut.'],
    },
    base: {
      probabilityPercent: { minimum: 40, maximum: 50 },
      expectedReturnPercent: { minimum: 8, maximum: 14 },
      assumptions: ['Current trend persists.'],
      requiredCatalysts: [],
      invalidationConditions: ['Margins contract.'],
    },
    bear: {
      probabilityPercent: { minimum: 20, maximum: 30 },
      expectedReturnPercent: { minimum: -25, maximum: -15 },
      assumptions: ['Demand weakens.'],
      requiredCatalysts: [],
      invalidationConditions: ['Demand accelerates.'],
    },
  },
  probabilityHigher: {
    sevenDays: { minimum: 50, maximum: 60 },
    thirtyDays: { minimum: 55, maximum: 65 },
    ninetyDays: { minimum: 60, maximum: 70 },
    twelveMonths: { minimum: 60, maximum: 75 },
  },
  pricedIn: {
    classification: 'PARTIALLY_PRICED_IN',
    explanation:
      'The initial move reflects some, but not all, of the evidence.',
  },
  volatilityRisk: 'MEDIUM',
  binaryCatalystExposure: false,
  downsideExplanation: 'The bear case reflects demand and margin compression.',
  ...overrides,
});

describe('Phase 6 decision engine', () => {
  it('separates scenario-weighted expected value from probability of profit', () => {
    const result = evaluateDecision(state(), inputs());

    expect(result.expectedValuePercent).toBeCloseTo(15, 1);
    expect(result.recommendation).toBe('BUY');
    expect(result.probabilityHigher.thirtyDays).toEqual({
      minimum: 55,
      maximum: 65,
    });
    expect(result.maxRecommendedPositionPercent.maximum).toBeGreaterThan(0);
    expect(result.humanReviewRequired).toBe(true);
  });

  it('returns insufficient data and zero size when coverage is low', () => {
    const result = evaluateDecision(state({ dataCoverage: 40 }), inputs());

    expect(result.recommendation).toBe('INSUFFICIENT_DATA');
    expect(result.expectedValuePercent).toBeNull();
    expect(result.maxRecommendedPositionPercent).toEqual({
      minimum: 0,
      maximum: 0,
    });
  });

  it('reduces size for binary catalysts and high volatility', () => {
    const normal = evaluateDecision(state(), inputs());
    const risky = evaluateDecision(
      state(),
      inputs({ binaryCatalystExposure: true, volatilityRisk: 'HIGH' }),
    );

    expect(risky.maxRecommendedPositionPercent.maximum).toBeLessThan(
      normal.maxRecommendedPositionPercent.maximum,
    );
  });

  it('rejects invalid probability distributions', () => {
    expect(() =>
      evaluateDecision(
        state(),
        inputs({
          scenarios: {
            ...inputs().scenarios,
            bull: {
              ...inputs().scenarios.bull,
              probabilityPercent: { minimum: 70, maximum: 80 },
            },
          },
        }),
      ),
    ).toThrow('plausible distribution');
  });
});
