import type {
  FullStockAnalysis,
  StockAnalysisContext,
  TargetedStockAnalysis,
} from '@watcher/core';
import { OllamaProvider } from '@watcher/llm';
import { describe, expect, it } from 'vitest';
import {
  buildNextThesisState,
  redundancyFor,
  StockIntelligenceAnalyzer,
} from '../analysis.js';

const context = (
  overrides: Partial<StockAnalysisContext> = {},
): StockAnalysisContext => ({
  event: {
    id: 'event-1',
    ticker: 'MU',
    eventType: 'EARNINGS',
    title: 'Micron reports results',
    materiality: 'HIGH',
    action: 'FULL_ANALYSIS',
    direction: 'POSITIVE',
    magnitude: {},
    occurredAt: '2026-09-05T06:00:00.000Z',
    firstPublicAt: '2026-09-05T06:00:00.000Z',
    firstDetectedAt: '2026-09-05T06:02:00.000Z',
    primaryDriverId: null,
    evidence: {
      source: 'SEC',
      sourceType: 'REGULATORY',
      sourceUrl: 'https://www.sec.gov/example',
      primarySource: true,
      reliability: 1,
    },
  },
  currentThesis: null,
  knownCatalysts: [],
  recentEvents: [],
  currentPriceContext: null,
  dataAvailability: [
    {
      group: 'EARNINGS_MOMENTUM',
      availability: 'AVAILABLE',
      weight: 1.4,
      reason: 'SEC results are available.',
    },
    {
      group: 'OPTIONS_POSITIONING',
      availability: 'DATA_UNAVAILABLE',
      weight: 1,
      reason: 'No options provider.',
    },
  ],
  dataCoverage: 70,
  dataQuality: 'MEDIUM',
  materialDataGaps: ['OPTIONS_POSITIONING'],
  insiderConviction: null,
  ...overrides,
});

const targeted: TargetedStockAnalysis = {
  materiality: 'HIGH',
  thesisChange: 'IMPROVED',
  informationChange: 'NEW_INFORMATION',
  reanalysisRequired: true,
  affectedSignalGroups: [
    {
      group: 'EARNINGS_MOMENTUM',
      score: 4,
      availability: 'AVAILABLE',
      explanation: 'Reported earnings evidence improved momentum.',
    },
  ],
  catalystChange: 'UNCHANGED',
  recommendationChange: false,
  primaryDriver: 'Earnings surprise',
  explanation: 'Primary-source results improve the working thesis.',
  risks: ['Demand could weaken.'],
  confidence: 0.8,
};

const full: FullStockAnalysis = {
  title: 'Earnings update',
  summary: 'Results improved the evidence set.',
  importance: 8,
  sentiment: 'positive',
  eventType: 'EARNINGS',
  positives: ['Momentum improved.'],
  negatives: [],
  risks: ['Demand could weaken.'],
  catalysts: ['Next earnings release.'],
  confidence: 0.8,
  thesis: 'Earnings momentum is improving, subject to demand durability.',
  verdict: 'WATCH',
  attentionScore: 82,
  primaryDrivers: ['Earnings surprise'],
  pricedIn: 'UNKNOWN',
  decisionInputs: {
    scenarios: {
      bull: {
        probabilityPercent: { minimum: 25, maximum: 35 },
        expectedReturnPercent: { minimum: 25, maximum: 45 },
        assumptions: [],
        requiredCatalysts: [],
        invalidationConditions: [],
      },
      base: {
        probabilityPercent: { minimum: 40, maximum: 50 },
        expectedReturnPercent: { minimum: 5, maximum: 12 },
        assumptions: [],
        requiredCatalysts: [],
        invalidationConditions: [],
      },
      bear: {
        probabilityPercent: { minimum: 20, maximum: 30 },
        expectedReturnPercent: { minimum: -25, maximum: -10 },
        assumptions: [],
        requiredCatalysts: [],
        invalidationConditions: [],
      },
    },
    probabilityHigher: {
      sevenDays: null,
      thirtyDays: { minimum: 50, maximum: 65 },
      ninetyDays: { minimum: 55, maximum: 70 },
      twelveMonths: { minimum: 55, maximum: 75 },
    },
    pricedIn: {
      classification: 'PARTIALLY_PRICED_IN',
      explanation: 'Only part of the evidence appears reflected in price.',
    },
    volatilityRisk: 'MEDIUM',
    binaryCatalystExposure: false,
    downsideExplanation: 'Demand weakness is the principal downside case.',
  },
};

const response = (value: unknown): Response =>
  new Response(
    JSON.stringify({ message: { content: JSON.stringify(value) } }),
    { status: 200 },
  );

describe('Phase 5 stock analysis', () => {
  it('weights independent primary evidence and discounts confidence for coverage', () => {
    const result = buildNextThesisState(context(), targeted, full);

    expect(result.reliabilityWeight).toBe(1.5);
    expect(result.redundancyMultiplier).toBe(1);
    expect(result.state.signalGroups).toContainEqual(
      expect.objectContaining({ group: 'EARNINGS_MOMENTUM', score: 5 }),
    );
    expect(result.state.confidence).toBeCloseTo(0.56);
    expect(result.state.dataCoverage).toBe(70);
    expect(result.state.materialDataGaps).toEqual(['OPTIONS_POSITIONING']);
  });

  it('does not count a known price reaction as independent evidence', () => {
    const reaction = context({
      event: {
        ...context().event,
        eventType: 'PRICE_ANOMALY',
        primaryDriverId: 'earnings-event',
      },
    });

    expect(redundancyFor(reaction)).toEqual({
      classification: 'HIGHLY_REDUNDANT',
      multiplier: 0.25,
    });
  });

  it('excludes unavailable signals from the net-signal denominator', () => {
    const result = buildNextThesisState(context(), targeted, full);

    expect(result.state.bullScore).toBe(5);
    expect(result.state.bearScore).toBe(0);
    expect(result.state.netSignal).toBe(5);
  });

  it('runs targeted then full analysis for the initial thesis', async () => {
    let call = 0;
    const analyzer = new StockIntelligenceAnalyzer(
      new OllamaProvider({
        url: 'http://ollama',
        model: 'test',
        retries: 0,
        fetch: async () => response(++call === 1 ? targeted : full),
      }),
    );
    const outcome = await analyzer.analyze('STOCKS', {
      id: 'SEC:1',
      source: 'SEC',
      externalId: '1',
      title: 'Micron reports results',
      url: 'https://www.sec.gov/example',
      content: 'Primary-source earnings evidence.',
      metadata: { stockAnalysisContext: context() },
    });

    expect(call).toBe(2);
    expect(outcome.status).toBe('SUCCESS');
    if (outcome.status !== 'SUCCESS' || !('intelligence' in outcome.result)) {
      throw new Error('Expected stock intelligence result');
    }
    expect(outcome.result.intelligence?.fullAnalysisPerformed).toBe(true);
    expect(outcome.result.intelligence?.decision?.humanReviewRequired).toBe(
      true,
    );
  });

  it('skips full analysis when targeted comparison finds no meaningful change', async () => {
    const existingState = buildNextThesisState(context(), targeted, full).state;
    const unchanged = {
      ...targeted,
      thesisChange: 'UNCHANGED' as const,
      informationChange: 'NO_MEANINGFUL_CHANGE' as const,
      reanalysisRequired: false,
    };
    let call = 0;
    const analyzer = new StockIntelligenceAnalyzer(
      new OllamaProvider({
        url: 'http://ollama',
        model: 'test',
        retries: 0,
        fetch: async () => {
          call += 1;
          return response(unchanged);
        },
      }),
    );
    const outcome = await analyzer.analyze('STOCKS', {
      id: 'NEWS:2',
      source: 'NEWS',
      externalId: '2',
      title: 'Follow-up report',
      url: 'https://example.com/news',
      content: 'No new facts beyond the primary event.',
      metadata: {
        stockAnalysisContext: context({
          currentThesis: existingState,
          event: {
            ...context().event,
            action: 'TARGETED_ANALYSIS',
          },
        }),
      },
    });

    expect(call).toBe(1);
    expect(outcome.status).toBe('SUCCESS');
    if (outcome.status !== 'SUCCESS' || !('intelligence' in outcome.result)) {
      throw new Error('Expected stock intelligence result');
    }
    expect(outcome.result.intelligence?.fullAnalysisPerformed).toBe(false);
    expect(outcome.result.intelligence?.decision).toBeNull();
  });
});
