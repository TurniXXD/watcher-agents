import type {
  FullStockAnalysis,
  StockAnalysisContext,
  TargetedStockAnalysis,
} from '@watcher/core';
import { OllamaProvider, type StructuredAttemptDiagnostic } from '@watcher/llm';
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
    eventTypes: ['EARNINGS'],
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
    const enrichedContext = context({
      event: {
        ...context().event,
        magnitude: {
          fundamentalDeltas: {
            revenueSurprisePercent: 12,
            latestEps: 1.4,
            latestEstimate: 1.1,
          },
        },
      },
      currentPriceContext: {
        observedAt: '2026-09-05T20:00:00.000Z',
        close: 110,
        dailyReturnPercent: 8,
        weeklyReturnPercent: 9,
        monthlyReturnPercent: 12,
        relativeVolume: 4,
        returnVolatilityRatio: 3,
        gapPercent: 2,
        volatilityPercent: 40,
        unexplained: false,
      },
    });
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
      metadata: { stockAnalysisContext: enrichedContext },
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
    expect(outcome.result.marketImpact).toMatchObject({
      ticker: 'MU',
      direction: 'bullish',
      fundamentals: {
        revenue: { signal: 'positive' },
        eps: { signal: 'neutral' },
      },
      marketReaction: {
        dailyReturnPct: 8,
        volumeRatio: 4,
        returnVolatilityRatio: 3,
        abnormalMove: true,
      },
    });
  });

  it('identifies which analysis stage failed without creating a thesis', async () => {
    let call = 0;
    const analyzer = new StockIntelligenceAnalyzer(
      new OllamaProvider({
        url: 'http://ollama',
        model: 'test',
        retries: 0,
        fetch: async () =>
          ++call === 1
            ? response(targeted)
            : Response.json({ message: { content: 'invalid JSON' } }),
      }),
    );
    const outcome = await analyzer.analyze('STOCKS', {
      id: 'SEC:full-failure',
      source: 'SEC',
      externalId: 'full-failure',
      title: 'Micron reports results',
      url: 'https://www.sec.gov/example',
      content: 'Primary-source earnings evidence.',
      metadata: { stockAnalysisContext: context() },
    });

    expect(call).toBe(2);
    expect(outcome.status).toBe('FAILED');
    if (outcome.status !== 'FAILED') throw new Error('Expected failure');
    expect(outcome.error).toContain('full stock analysis failed:');
  });

  it('does not promote a schema-incomplete targeted response into a thesis', async () => {
    const analyzer = new StockIntelligenceAnalyzer(
      new OllamaProvider({
        url: 'http://ollama',
        model: 'test',
        retries: 0,
        fetch: async () =>
          response({
            materiality: 'HIGH',
            thesisChange: 'IMPROVED',
            informationChange: 'NEW_INFORMATION',
          }),
      }),
    );
    const outcome = await analyzer.analyze('STOCKS', {
      id: 'SEC:incomplete',
      source: 'SEC',
      externalId: 'incomplete',
      title: 'Micron reports results',
      url: 'https://www.sec.gov/example',
      content: 'Primary-source earnings evidence.',
      metadata: { stockAnalysisContext: context() },
    });

    expect(outcome.status).toBe('FAILED');
    if (outcome.status !== 'FAILED') throw new Error('Expected failure');
    expect(outcome.error).toContain('targeted stock analysis failed:');
    expect(outcome.error).toContain('primaryDriver');
  });

  it('repairs the observed company-intelligence field failures before creating a thesis', async () => {
    const diagnostics: StructuredAttemptDiagnostic[] = [];
    const requests: Array<{ options: { temperature: number } }> = [];
    let call = 0;
    const analyzer = new StockIntelligenceAnalyzer(
      new OllamaProvider({
        url: 'http://ollama',
        model: 'test',
        retries: 1,
        onStructuredAttempt: (attempt) => diagnostics.push(attempt),
        fetch: async (_url, init) => {
          if (typeof init?.body !== 'string') {
            throw new Error('Expected JSON request body');
          }
          requests.push(
            JSON.parse(init.body) as {
              options: { temperature: number };
            },
          );
          call += 1;
          return response(
            call === 1
              ? {
                  materiality: 'LOW',
                  thesisChange: 'UNCHANGED',
                  informationChange: 'NO_MEANINGFUL_CHANGE',
                  explanation: '',
                  risks: [],
                  confidence: -0.1,
                }
              : call === 2
                ? targeted
                : full,
          );
        },
      }),
    );

    const outcome = await analyzer.analyze('STOCKS', {
      id: 'COMPANY_INTELLIGENCE:logged-shape',
      source: 'COMPANY_INTELLIGENCE',
      externalId: 'logged-shape',
      title: 'Issuer announcement',
      url: 'https://example.com/release',
      content: 'Evidence-backed issuer announcement.',
      metadata: { stockAnalysisContext: context() },
    });

    expect(outcome.status).toBe('SUCCESS');
    expect(call).toBe(3);
    expect(requests.every(({ options }) => options.temperature === 0)).toBe(
      true,
    );
    expect(
      diagnostics.map(({ label, outcome: result }) => [label, result]),
    ).toEqual([
      ['stock_targeted', 'INVALID_SCHEMA'],
      ['stock_targeted', 'VALID'],
      ['stock_full', 'VALID'],
    ]);
    expect(diagnostics[0]?.schemaPaths).toEqual(
      expect.arrayContaining(['primaryDriver', 'explanation', 'confidence']),
    );
    expect(diagnostics[0]).not.toHaveProperty('content');
  });

  it('accepts explicit text inside stock field objects and percent confidence', async () => {
    const diagnostics: StructuredAttemptDiagnostic[] = [];
    let call = 0;
    const analyzer = new StockIntelligenceAnalyzer(
      new OllamaProvider({
        url: 'http://ollama',
        model: 'test',
        retries: 0,
        onStructuredAttempt: (attempt) => diagnostics.push(attempt),
        fetch: async () =>
          response(
            ++call === 1
              ? {
                  targeted: {
                    ...targeted,
                    primaryDriver: { description: 'Earnings surprise' },
                    risks: [{ risk: 'Demand could weaken.' }],
                    confidence: 80,
                  },
                }
              : {
                  fullAnalysis: {
                    ...full,
                    risks: [{ description: 'Demand could weaken.' }],
                    confidence: '80%',
                  },
                },
          ),
      }),
    );

    const outcome = await analyzer.analyze('STOCKS', {
      id: 'TRADINGVIEW_NEWS:object-fields',
      source: 'TRADINGVIEW_NEWS',
      externalId: 'object-fields',
      title: 'Micron reports results',
      url: 'https://example.com/story',
      content: 'Source-backed earnings evidence.',
      metadata: { stockAnalysisContext: context() },
    });

    expect(outcome.status).toBe('SUCCESS');
    expect(call).toBe(2);
    expect(diagnostics.map(({ outcome: result }) => result)).toEqual([
      'VALID',
      'VALID',
    ]);
    if (outcome.status !== 'SUCCESS' || !('intelligence' in outcome.result)) {
      throw new Error('Expected stock intelligence result');
    }
    expect(outcome.result.intelligence?.targeted.primaryDriver).toBe(
      'Earnings surprise',
    );
    expect(outcome.result.intelligence?.targeted.risks).toEqual([
      'Demand could weaken.',
    ]);
  });

  it('normalizes explicit targeted enum labels without inventing missing classifications', async () => {
    const diagnostics: StructuredAttemptDiagnostic[] = [];
    const requests: Array<{
      format: { properties: Record<string, unknown> };
      messages: Array<{ content: string }>;
    }> = [];
    let call = 0;
    const analyzer = new StockIntelligenceAnalyzer(
      new OllamaProvider({
        url: 'http://ollama',
        model: 'test',
        retries: 0,
        onStructuredAttempt: (attempt) => diagnostics.push(attempt),
        fetch: async (_url, init) => {
          if (typeof init?.body !== 'string')
            throw new Error('Missing request body');
          requests.push(
            JSON.parse(init.body) as {
              format: { properties: Record<string, unknown> };
              messages: Array<{ content: string }>;
            },
          );
          return response(
            ++call === 1
              ? {
                  ...targeted,
                  thesisChange: { classification: 'improved' },
                  informationChange: { label: 'new information' },
                }
              : full,
          );
        },
      }),
    );

    const outcome = await analyzer.analyze('STOCKS', {
      id: 'SEC:enum-objects',
      source: 'SEC',
      externalId: 'enum-objects',
      title: 'Micron reports results',
      url: 'https://www.sec.gov/example',
      content: 'Primary-source earnings evidence.',
      metadata: { stockAnalysisContext: context() },
    });

    expect(outcome.status).toBe('SUCCESS');
    if (outcome.status !== 'SUCCESS' || !('intelligence' in outcome.result)) {
      throw new Error('Expected stock intelligence result');
    }
    expect(outcome.result.intelligence?.targeted).toMatchObject({
      thesisChange: 'IMPROVED',
      informationChange: 'NEW_INFORMATION',
    });
    expect(diagnostics.map(({ outcome: result }) => result)).toEqual([
      'VALID',
      'VALID',
    ]);
    expect(requests[0]?.format.properties.thesisChange).toMatchObject({
      type: 'string',
    });
    expect(requests[0]?.messages[0]?.content).toContain(
      'These two properties are mandatory',
    );
  });

  it('logs only field kinds when targeted enum values are missing and keeps analysis failed', async () => {
    const diagnostics: StructuredAttemptDiagnostic[] = [];
    const analyzer = new StockIntelligenceAnalyzer(
      new OllamaProvider({
        url: 'http://ollama',
        model: 'test',
        retries: 0,
        onStructuredAttempt: (attempt) => diagnostics.push(attempt),
        fetch: async () =>
          response({
            ...targeted,
            thesisChange: null,
            informationChange: null,
          }),
      }),
    );

    const outcome = await analyzer.analyze('STOCKS', {
      id: 'SEC:missing-enums',
      source: 'SEC',
      externalId: 'missing-enums',
      title: 'Micron reports results',
      url: 'https://www.sec.gov/example',
      content: 'Primary-source earnings evidence.',
      metadata: { stockAnalysisContext: context() },
    });

    expect(outcome.status).toBe('FAILED');
    expect(diagnostics[0]).toMatchObject({
      outcome: 'INVALID_SCHEMA',
      schemaFieldKinds: { thesisChange: 'null', informationChange: 'null' },
    });
    expect(diagnostics[0]).not.toHaveProperty('content');
  });

  it('repairs only missing change classifications with a separate evidence-bound call', async () => {
    const diagnostics: StructuredAttemptDiagnostic[] = [];
    let targetedCalls = 0;
    const analyzer = new StockIntelligenceAnalyzer(
      new OllamaProvider({
        url: 'http://ollama',
        model: 'test',
        retries: 2,
        onStructuredAttempt: (attempt) => diagnostics.push(attempt),
        fetch: async (_url, init) => {
          if (typeof init?.body !== 'string')
            throw new Error('Missing request body');
          const request = JSON.parse(init.body) as {
            format: { required: string[] };
          };
          if (request.format.required.length === 2) {
            return response({
              thesisChange: 'IMPROVED',
              informationChange: 'NEW_INFORMATION',
            });
          }
          if (request.format.required.includes('primaryDriver')) {
            targetedCalls += 1;
            return response({
              ...targeted,
              thesisChange: null,
              informationChange: null,
            });
          }
          return response(full);
        },
      }),
    );

    const outcome = await analyzer.analyze('STOCKS', {
      id: 'SEC:enum-repair',
      source: 'SEC',
      externalId: 'enum-repair',
      title: 'Micron reports results',
      url: 'https://www.sec.gov/example',
      content: 'Primary-source earnings evidence.',
      metadata: { stockAnalysisContext: context() },
    });

    expect(outcome.status).toBe('SUCCESS');
    expect(targetedCalls).toBe(3);
    expect(
      diagnostics.map(({ label, outcome: result }) => [label, result]),
    ).toEqual([
      ['stock_targeted', 'INVALID_SCHEMA'],
      ['stock_targeted', 'INVALID_SCHEMA'],
      ['stock_targeted', 'INVALID_SCHEMA'],
      ['stock_targeted_change_repair', 'VALID'],
      ['stock_full', 'VALID'],
    ]);
    if (outcome.status !== 'SUCCESS')
      throw new Error('Expected successful repair');
    expect(outcome.metrics?.llmCallCount).toBe(5);
  });

  it('still rejects a risk object without explicit risk text', async () => {
    const analyzer = new StockIntelligenceAnalyzer(
      new OllamaProvider({
        url: 'http://ollama',
        model: 'test',
        retries: 0,
        fetch: async () =>
          response({ ...targeted, risks: [{ direction: 'negative' }] }),
      }),
    );

    const outcome = await analyzer.analyze('STOCKS', {
      id: 'TRADINGVIEW_NEWS:unsupported-risk',
      source: 'TRADINGVIEW_NEWS',
      externalId: 'unsupported-risk',
      title: 'Micron reports results',
      url: 'https://example.com/story',
      content: 'Source-backed earnings evidence.',
      metadata: { stockAnalysisContext: context() },
    });

    expect(outcome.status).toBe('FAILED');
    if (outcome.status !== 'FAILED') throw new Error('Expected failure');
    expect(outcome.error).toContain('risks');
  });

  it('accepts a sourced thesis without unsupported scenario inputs', async () => {
    const requests: Array<{
      format: { required: string[] };
      messages: Array<{ content: string }>;
    }> = [];
    let call = 0;
    const withoutScenarios = { ...full };
    delete withoutScenarios.decisionInputs;
    const analyzer = new StockIntelligenceAnalyzer(
      new OllamaProvider({
        url: 'http://ollama',
        model: 'test',
        retries: 0,
        fetch: async (_url, init) => {
          if (typeof init?.body !== 'string') {
            throw new Error('Expected JSON request body');
          }
          requests.push(
            JSON.parse(init.body) as {
              format: { required: string[] };
              messages: Array<{ content: string }>;
            },
          );
          return response(++call === 1 ? targeted : withoutScenarios);
        },
      }),
    );

    const outcome = await analyzer.analyze('STOCKS', {
      id: 'TRADINGVIEW_NEWS:limited-evidence',
      source: 'TRADINGVIEW_NEWS',
      externalId: 'limited-evidence',
      title: 'New company evidence',
      url: 'https://example.com/story',
      content: 'Sourced company facts without supported return probabilities.',
      metadata: { stockAnalysisContext: context() },
    });

    expect(outcome.status).toBe('SUCCESS');
    if (outcome.status !== 'SUCCESS' || !('intelligence' in outcome.result)) {
      throw new Error('Expected stock intelligence result');
    }
    expect(outcome.result.intelligence?.decision).toBeNull();
    expect(requests[1]?.format.required).not.toContain('decisionInputs');
    expect(requests[1]?.messages[0]?.content).toContain(
      'omit decisionInputs entirely if the evidence cannot support',
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

  it('normalizes omitted helper fields from a compact targeted response', async () => {
    const existingState = buildNextThesisState(context(), targeted, full).state;
    const compactTargeted = {
      materiality: 'LOW',
      thesisChange: 'UNCHANGED',
      informationChange: 'NO_MEANINGFUL_CHANGE',
      catalystChange: 'NO_CHANGE',
      primaryDriver: 'Routine filing update',
      explanation: 'The filing does not materially change the current thesis.',
      risks: [],
      confidence: 0.7,
    };
    const analyzer = new StockIntelligenceAnalyzer(
      new OllamaProvider({
        url: 'http://ollama',
        model: 'test',
        retries: 0,
        fetch: async () => response(compactTargeted),
      }),
    );

    const outcome = await analyzer.analyze('STOCKS', {
      id: 'SEC:compact',
      source: 'SEC',
      externalId: 'compact',
      title: 'Routine filing update',
      url: 'https://www.sec.gov/example',
      content: 'A routine filing with no material thesis change.',
      metadata: {
        stockAnalysisContext: context({
          currentThesis: existingState,
          event: { ...context().event, action: 'TARGETED_ANALYSIS' },
        }),
      },
    });

    if (outcome.status !== 'SUCCESS') {
      throw new Error(`Expected stock intelligence result: ${outcome.error}`);
    }
    if (!('intelligence' in outcome.result)) {
      throw new Error('Expected stock intelligence result');
    }
    expect(outcome.result.intelligence?.targeted).toMatchObject({
      reanalysisRequired: false,
      affectedSignalGroups: [],
      catalystChange: 'UNCHANGED',
      recommendationChange: false,
    });
    expect(outcome.result.intelligence?.fullAnalysisPerformed).toBe(false);
  });

  it('keeps targeted prompts bounded and prioritizes evidence-backed required fields', async () => {
    const existingState = buildNextThesisState(context(), targeted, full).state;
    let request:
      | {
          format: { required: string[] };
          messages: { content: string }[];
        }
      | undefined;
    const analyzer = new StockIntelligenceAnalyzer(
      new OllamaProvider({
        url: 'http://ollama',
        model: 'test',
        retries: 0,
        fetch: async (_url, init) => {
          if (typeof init?.body !== 'string') {
            throw new Error('Expected JSON request body');
          }
          request = JSON.parse(init.body) as typeof request;
          return response({
            ...targeted,
            reanalysisRequired: false,
            thesisChange: 'UNCHANGED',
            informationChange: 'NO_MEANINGFUL_CHANGE',
          });
        },
      }),
    );
    const outcome = await analyzer.analyze('STOCKS', {
      id: 'NEWS:bounded',
      source: 'NEWS',
      externalId: 'bounded',
      title: 'Micron update',
      url: 'https://example.com/micron',
      content: `Sourced evidence at the beginning. ${'Further source detail. '.repeat(800)}`,
      metadata: {
        stockAnalysisContext: context({
          currentThesis: existingState,
          event: { ...context().event, action: 'TARGETED_ANALYSIS' },
        }),
      },
    });

    expect(outcome.status).toBe('SUCCESS');
    expect(request?.messages[0]?.content.length).toBeLessThan(8_000);
    expect(request?.messages[0]?.content).toContain(
      'Sourced evidence at the beginning.',
    );
    expect(request?.messages[0]?.content).toContain(
      'Always include nonempty primaryDriver and explanation',
    );
    expect(request?.format.required).toEqual([
      'primaryDriver',
      'explanation',
      'risks',
      'confidence',
      'materiality',
      'thesisChange',
      'informationChange',
    ]);
  });
});
