import {
  clamp,
  errorMessage,
  fullStockAnalysisSchema,
  marketImpactAnalysisSchema,
  signalGroupSchema,
  stockAnalysisContextSchema,
  targetedStockAnalysisSchema,
  type AnalysisOutcome,
  type Analyzer,
  type DataAvailability,
  type FullStockAnalysis,
  type MarketImpactAnalysis,
  type RedundancyClass,
  type SignalGroupState,
  type StockAnalysisContext,
  type StockThesisState,
  type TargetedStockAnalysis,
  type WatchItem,
  type WatcherKind,
} from '@watcher/core';
import type { OllamaProvider, StructuredJsonSchema } from '@watcher/llm';
import { evaluateDecision } from './decision.js';

const rangeJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['minimum', 'maximum'],
  properties: {
    minimum: { type: 'number' },
    maximum: { type: 'number' },
  },
} as const;

const scenarioJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'probabilityPercent',
    'expectedReturnPercent',
    'assumptions',
    'requiredCatalysts',
    'invalidationConditions',
  ],
  properties: {
    probabilityPercent: rangeJsonSchema,
    expectedReturnPercent: rangeJsonSchema,
    assumptions: { type: 'array', items: { type: 'string' } },
    requiredCatalysts: { type: 'array', items: { type: 'string' } },
    invalidationConditions: { type: 'array', items: { type: 'string' } },
  },
} as const;

const targetedJsonSchema: StructuredJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'materiality',
    'thesisChange',
    'informationChange',
    'reanalysisRequired',
    'affectedSignalGroups',
    'catalystChange',
    'recommendationChange',
    'primaryDriver',
    'explanation',
    'risks',
    'confidence',
  ],
  properties: {
    materiality: { enum: ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'EXTREME'] },
    thesisChange: {
      enum: [
        'STRONGLY_IMPROVED',
        'IMPROVED',
        'UNCHANGED',
        'DETERIORATED',
        'STRONGLY_DETERIORATED',
      ],
    },
    informationChange: {
      enum: [
        'NEW_INFORMATION',
        'UPDATED_INFORMATION',
        'INVALIDATED_INFORMATION',
        'PRICE_ONLY_CHANGE',
        'NO_MEANINGFUL_CHANGE',
      ],
    },
    reanalysisRequired: { type: 'boolean' },
    affectedSignalGroups: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['group', 'score', 'availability', 'explanation'],
        properties: {
          group: { enum: signalGroupSchema.options },
          score: { type: 'number', minimum: -5, maximum: 5 },
          availability: {
            enum: ['AVAILABLE', 'DATA_UNAVAILABLE', 'NOT_APPLICABLE'],
          },
          explanation: { type: 'string' },
        },
      },
    },
    catalystChange: { enum: ['ADDED', 'UPDATED', 'REMOVED', 'UNCHANGED'] },
    recommendationChange: { type: 'boolean' },
    primaryDriver: { type: 'string' },
    explanation: { type: 'string' },
    risks: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

const fullJsonSchema: StructuredJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'summary',
    'importance',
    'sentiment',
    'eventType',
    'positives',
    'negatives',
    'risks',
    'catalysts',
    'confidence',
    'thesis',
    'verdict',
    'attentionScore',
    'primaryDrivers',
    'pricedIn',
    'decisionInputs',
  ],
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    importance: { type: 'integer', minimum: 1, maximum: 10 },
    sentiment: { enum: ['positive', 'neutral', 'negative'] },
    eventType: { type: 'string' },
    positives: { type: 'array', items: { type: 'string' } },
    negatives: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    catalysts: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    thesis: { type: 'string' },
    verdict: { enum: ['WATCH', 'WAIT', 'INSUFFICIENT_DATA'] },
    attentionScore: { type: 'integer', minimum: 0, maximum: 100 },
    primaryDrivers: { type: 'array', items: { type: 'string' } },
    pricedIn: {
      enum: [
        'NOT_PRICED_IN',
        'PARTIALLY_PRICED_IN',
        'MOSTLY_PRICED_IN',
        'OVERPRICED_EXPECTATIONS',
        'UNKNOWN',
      ],
    },
    decisionInputs: {
      type: 'object',
      additionalProperties: false,
      required: [
        'scenarios',
        'probabilityHigher',
        'pricedIn',
        'volatilityRisk',
        'binaryCatalystExposure',
        'downsideExplanation',
      ],
      properties: {
        scenarios: {
          type: 'object',
          additionalProperties: false,
          required: ['bull', 'base', 'bear'],
          properties: {
            bull: scenarioJsonSchema,
            base: scenarioJsonSchema,
            bear: scenarioJsonSchema,
          },
        },
        probabilityHigher: {
          type: 'object',
          additionalProperties: false,
          required: ['sevenDays', 'thirtyDays', 'ninetyDays', 'twelveMonths'],
          properties: {
            sevenDays: { anyOf: [{ type: 'null' }, rangeJsonSchema] },
            thirtyDays: { anyOf: [{ type: 'null' }, rangeJsonSchema] },
            ninetyDays: { anyOf: [{ type: 'null' }, rangeJsonSchema] },
            twelveMonths: { anyOf: [{ type: 'null' }, rangeJsonSchema] },
          },
        },
        pricedIn: {
          type: 'object',
          additionalProperties: false,
          required: ['classification', 'explanation'],
          properties: {
            classification: {
              enum: [
                'NOT_PRICED_IN',
                'PARTIALLY_PRICED_IN',
                'MOSTLY_PRICED_IN',
                'OVERPRICED_EXPECTATIONS',
                'UNKNOWN',
              ],
            },
            explanation: { type: 'string' },
          },
        },
        volatilityRisk: { enum: ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'] },
        binaryCatalystExposure: { type: 'boolean' },
        downsideExplanation: { type: 'string' },
      },
    },
  },
};

const unique = (values: string[], maximum = 8): string[] =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(
    0,
    maximum,
  );

export const reliabilityWeightFor = (context: StockAnalysisContext): number => {
  const evidence = context.event.evidence;
  if (
    evidence.primarySource &&
    (evidence.sourceType === 'REGULATORY' ||
      evidence.sourceType === 'INVESTOR_RELATIONS')
  ) {
    return 1.5;
  }
  if (evidence.sourceType === 'MARKET_DATA') return 0.9;
  if (evidence.sourceType === 'OTHER') return 0.5;
  return clamp(evidence.reliability || 1, 0.5, 1.4);
};

export const redundancyFor = (
  context: StockAnalysisContext,
): { classification: RedundancyClass; multiplier: number } => {
  if (!context.event.primaryDriverId) {
    return { classification: 'INDEPENDENT', multiplier: 1 };
  }
  if (context.event.eventType === 'ANALYST_REVISION') {
    return { classification: 'PARTIALLY_REDUNDANT', multiplier: 0.5 };
  }
  if (
    ['PRICE_ANOMALY', 'VOLUME_ANOMALY', 'OPTIONS_ANOMALY'].includes(
      context.event.eventType,
    )
  ) {
    return { classification: 'HIGHLY_REDUNDANT', multiplier: 0.25 };
  }
  return { classification: 'PARTIALLY_REDUNDANT', multiplier: 0.5 };
};

const mergeSignalGroups = (
  context: StockAnalysisContext,
  targeted: TargetedStockAnalysis,
  reliabilityWeight: number,
  redundancyMultiplier: number,
): SignalGroupState[] => {
  const current = new Map(
    (context.currentThesis?.signalGroups ?? []).map((entry) => [
      entry.group,
      entry,
    ]),
  );
  const availability = new Map(
    context.dataAvailability.map((entry) => [entry.group, entry]),
  );
  const affected = new Map(
    targeted.affectedSignalGroups.map((entry) => [entry.group, entry]),
  );

  return signalGroupSchema.options.map((group): SignalGroupState => {
    const previous = current.get(group);
    const update = affected.get(group);
    const configuredAvailability = availability.get(group)?.availability;
    const nextAvailability: DataAvailability =
      configuredAvailability ??
      update?.availability ??
      previous?.availability ??
      'DATA_UNAVAILABLE';
    if (!update || update.availability !== 'AVAILABLE') {
      return {
        group,
        score: nextAvailability === 'AVAILABLE' ? (previous?.score ?? 0) : 0,
        availability: nextAvailability,
        explanation:
          update?.explanation ??
          previous?.explanation ??
          availability.get(group)?.reason ??
          'No supported data is currently available.',
      };
    }
    const adjusted = update.score * reliabilityWeight * redundancyMultiplier;
    return {
      group,
      score: clamp((previous?.score ?? 0) + adjusted, -5, 5),
      availability: 'AVAILABLE',
      explanation: update.explanation,
    };
  });
};

const scoreGroups = (
  groups: SignalGroupState[],
): { bullScore: number; bearScore: number; netSignal: number } => {
  const available = groups.filter(
    ({ availability }) => availability === 'AVAILABLE',
  );
  const bullScore = available.reduce(
    (total, { score }) => total + Math.max(0, score),
    0,
  );
  const bearScore = available.reduce(
    (total, { score }) => total + Math.abs(Math.min(0, score)),
    0,
  );
  const netSignal =
    available.length === 0
      ? 0
      : clamp((bullScore - bearScore) / available.length, -5, 5);
  return { bullScore, bearScore, netSignal };
};

const attentionFloor = (
  context: StockAnalysisContext,
  targeted: TargetedStockAnalysis,
): number => {
  const materiality = { NONE: 0, LOW: 20, MEDIUM: 50, HIGH: 75, EXTREME: 95 }[
    context.event.materiality
  ];
  const thesis = {
    STRONGLY_IMPROVED: 15,
    IMPROVED: 8,
    UNCHANGED: 0,
    DETERIORATED: 8,
    STRONGLY_DETERIORATED: 15,
  }[targeted.thesisChange];
  return clamp(
    materiality + thesis + (context.currentPriceContext?.unexplained ? 5 : 0),
    0,
    100,
  );
};

export const buildNextThesisState = (
  context: StockAnalysisContext,
  targeted: TargetedStockAnalysis,
  full: FullStockAnalysis | null,
): {
  state: StockThesisState;
  redundancyClass: RedundancyClass;
  redundancyMultiplier: number;
  reliabilityWeight: number;
} => {
  const reliabilityWeight = reliabilityWeightFor(context);
  const redundancy = redundancyFor(context);
  const signalGroups = mergeSignalGroups(
    context,
    targeted,
    reliabilityWeight,
    redundancy.multiplier,
  );
  const scores = scoreGroups(signalGroups);
  const prior = context.currentThesis;
  const coverageConfidenceFactor = Math.max(0.35, context.dataCoverage / 100);
  const confidence = clamp(
    (full?.confidence ?? targeted.confidence) * coverageConfidenceFactor,
    0,
    1,
  );
  const knownCatalysts = context.knownCatalysts.map(
    ({ description }) => description,
  );
  const state: StockThesisState = {
    ticker: context.event.ticker,
    thesis:
      full?.thesis ??
      prior?.thesis ??
      `Initial thesis is pending; latest evidence: ${targeted.explanation}`,
    verdict:
      full?.verdict ??
      prior?.verdict ??
      (context.dataCoverage < 50 ? 'INSUFFICIENT_DATA' : 'WAIT'),
    confidence,
    attentionScore: Math.max(
      prior?.attentionScore ?? 0,
      full?.attentionScore ?? 0,
      attentionFloor(context, targeted),
    ),
    ...scores,
    signalGroups,
    catalysts: unique([...(full?.catalysts ?? []), ...knownCatalysts]),
    insiderConviction: context.insiderConviction,
    pricedIn: full?.pricedIn ?? prior?.pricedIn ?? 'UNKNOWN',
    primaryDrivers: unique([
      ...(full?.primaryDrivers ?? []),
      targeted.primaryDriver,
      ...(prior?.primaryDrivers ?? []),
    ]),
    risks: unique([
      ...(full?.risks ?? targeted.risks),
      ...(prior?.risks ?? []),
    ]),
    dataCoverage: context.dataCoverage,
    dataQuality: context.dataQuality,
    materialDataGaps: context.materialDataGaps,
    decision: prior?.decision ?? null,
  };
  return {
    state,
    redundancyClass: redundancy.classification,
    redundancyMultiplier: redundancy.multiplier,
    reliabilityWeight,
  };
};

const targetedPrompt = (
  item: WatchItem,
  context: StockAnalysisContext,
): string => `You perform targeted stock-event analysis for a private research watcher.
Use only the supplied evidence and context. Facts and inference must remain distinct.
Missing data is not neutral evidence. Do not infer illegal conduct or information leaks.
Identify the underlying primary driver, not downstream headlines or price reactions.
Score only signal groups genuinely affected by this event from -5 to +5.
Return only JSON matching the supplied schema.

SOURCE CONTENT:
${item.content.slice(0, 10_000)}

CURRENT STATE AND EVENT CONTEXT:
${JSON.stringify(context)}`;

const fullPrompt = (
  item: WatchItem,
  context: StockAnalysisContext,
  targeted: TargetedStockAnalysis,
): string => `Update the persistent company thesis after a material event.
Use only supplied facts. Clearly qualify inference and uncertainty.
The verdict field is an analytical status only and must be WATCH, WAIT, or INSUFFICIENT_DATA. A deterministic engine will calculate any recommendation.
Do not translate net signal directly into probability and do not invent unavailable fundamentals, valuation, or market expectations.
Return broad probability and return ranges. Use null for probability horizons without enough evidence. Bear-case returns must be non-positive. Scenario probability midpoints should sum to roughly 100%.
Return only JSON matching the supplied schema.

SOURCE CONTENT:
${item.content.slice(0, 10_000)}

TARGETED EVENT ASSESSMENT:
${JSON.stringify(targeted)}

CURRENT STATE AND EVENT CONTEXT:
${JSON.stringify(context)}`;

const fallbackAnalysis = (
  context: StockAnalysisContext,
  targeted: TargetedStockAnalysis,
): FullStockAnalysis => {
  const positive = targeted.affectedSignalGroups
    .filter(({ score }) => score > 0)
    .map(({ explanation }) => explanation);
  const negative = targeted.affectedSignalGroups
    .filter(({ score }) => score < 0)
    .map(({ explanation }) => explanation);
  const sentiment =
    targeted.thesisChange === 'IMPROVED' ||
    targeted.thesisChange === 'STRONGLY_IMPROVED'
      ? ('positive' as const)
      : targeted.thesisChange === 'DETERIORATED' ||
          targeted.thesisChange === 'STRONGLY_DETERIORATED'
        ? ('negative' as const)
        : ('neutral' as const);
  return {
    title: context.event.title,
    summary: targeted.explanation,
    importance: Math.max(
      1,
      Math.min(
        10,
        Math.round(
          context.event.materiality === 'EXTREME'
            ? 10
            : context.event.materiality === 'HIGH'
              ? 8
              : 6,
        ),
      ),
    ),
    sentiment,
    eventType: context.event.eventType,
    positives: positive,
    negatives: negative,
    risks: targeted.risks,
    catalysts:
      targeted.catalystChange === 'UNCHANGED'
        ? []
        : context.knownCatalysts.map(({ description }) => description),
    confidence: targeted.confidence,
    thesis:
      context.currentThesis?.thesis ??
      `Initial thesis is pending; latest evidence: ${targeted.explanation}`,
    verdict:
      context.currentThesis?.verdict === 'WAIT' ||
      context.currentThesis?.verdict === 'INSUFFICIENT_DATA'
        ? context.currentThesis.verdict
        : 'WATCH',
    attentionScore: attentionFloor(context, targeted),
    primaryDrivers: [targeted.primaryDriver],
    pricedIn: context.currentThesis?.pricedIn ?? 'UNKNOWN',
  };
};

const marketImpactFor = (
  context: StockAnalysisContext,
  targeted: TargetedStockAnalysis,
): MarketImpactAnalysis => {
  const price = context.currentPriceContext;
  const rawFundamentals = context.event.magnitude.fundamentalDeltas;
  const fundamentalDeltas =
    typeof rawFundamentals === 'object' &&
    rawFundamentals !== null &&
    !Array.isArray(rawFundamentals)
      ? (rawFundamentals as Record<string, unknown>)
      : {};
  const fundamentalGroups = {
    revenue: /^revenue|^latestRevenue/u,
    eps: /^eps|^latestEps|^latestEstimate/u,
    margins: /margin/u,
    guidance: /^guidance/u,
    cashFlow: /cashFlow|freeCashFlow/u,
    balanceSheet: /^debt$|^cash$/u,
  } as const;
  const fundamentals = Object.fromEntries(
    Object.entries(fundamentalGroups).flatMap(([group, pattern]) => {
      const facts = Object.entries(fundamentalDeltas).filter(([key]) =>
        pattern.test(key),
      );
      if (facts.length === 0) return [];
      const directionalValue = facts.find(
        ([key, value]) =>
          /surprise|change|yoy|delta/iu.test(key) &&
          typeof value === 'number' &&
          Number.isFinite(value),
      )?.[1];
      const signal =
        typeof directionalValue !== 'number' || directionalValue === 0
          ? 'neutral'
          : directionalValue > 0
            ? 'positive'
            : 'negative';
      return [
        [
          group,
          {
            signal,
            details: facts
              .map(([key, value]) => `${key}: ${String(value)}`)
              .join('; '),
          },
        ],
      ];
    }),
  );
  const direction =
    targeted.thesisChange === 'IMPROVED' ||
    targeted.thesisChange === 'STRONGLY_IMPROVED'
      ? 'bullish'
      : targeted.thesisChange === 'DETERIORATED' ||
          targeted.thesisChange === 'STRONGLY_DETERIORATED'
        ? 'bearish'
        : targeted.affectedSignalGroups.some(({ score }) => score !== 0)
          ? 'mixed'
          : 'neutral';
  return marketImpactAnalysisSchema.parse({
    ticker: context.event.ticker,
    direction,
    magnitude:
      context.event.materiality === 'NONE'
        ? 'low'
        : (context.event.materiality.toLowerCase() as
            'low' | 'medium' | 'high' | 'extreme'),
    confidence: targeted.confidence,
    primaryCatalyst: targeted.primaryDriver,
    secondaryCatalysts: context.event.eventTypes
      .filter((type) => type !== context.event.eventType)
      .map((type) => type.replaceAll('_', ' ').toLowerCase()),
    amplifiers: [
      ...(price?.unexplained ? ['Unexplained market reaction'] : []),
      ...((price?.relativeVolume ?? 0) >= 3 ? ['Unusual volume'] : []),
      ...((price?.returnVolatilityRatio ?? 0) >= 2.5
        ? ['Move large relative to recent volatility']
        : []),
    ],
    ...(Object.keys(fundamentals).length === 0 ? {} : { fundamentals }),
    ...(price
      ? {
          marketReaction: {
            ...(price.dailyReturnPercent === null
              ? {}
              : { dailyReturnPct: price.dailyReturnPercent }),
            ...(price.gapPercent === null ? {} : { gapPct: price.gapPercent }),
            ...(price.relativeVolume === null
              ? {}
              : { volumeRatio: price.relativeVolume }),
            ...(price.returnVolatilityRatio === null
              ? {}
              : { returnVolatilityRatio: price.returnVolatilityRatio }),
            abnormalMove:
              Math.abs(price.dailyReturnPercent ?? 0) >= 5 ||
              (price.relativeVolume ?? 0) >= 3 ||
              (price.returnVolatilityRatio ?? 0) >= 2.5,
          },
        }
      : {}),
    thesisImpact:
      direction === 'bullish'
        ? 'strengthens'
        : direction === 'bearish'
          ? 'weakens'
          : direction === 'neutral'
            ? 'unchanged'
            : 'requires_review',
    summary: targeted.explanation,
  });
};

export class StockIntelligenceAnalyzer implements Analyzer {
  public constructor(
    private readonly ollama: OllamaProvider,
    private readonly fullAnalysisNumPredict = 1536,
  ) {}

  public async analyze(
    kind: WatcherKind,
    item: WatchItem,
    signal?: AbortSignal,
  ): Promise<AnalysisOutcome> {
    if (kind !== 'STOCKS') {
      return this.ollama.analyze(kind, item, signal);
    }
    const parsedContext = stockAnalysisContextSchema.safeParse(
      item.metadata.stockAnalysisContext,
    );
    if (!parsedContext.success) {
      return this.ollama.analyze(kind, item, signal);
    }
    try {
      const context = parsedContext.data;
      const targetedGeneration =
        await this.ollama.generateStructuredWithMetrics(
          targetedPrompt(item, context),
          targetedJsonSchema,
          targetedStockAnalysisSchema,
          signal,
        );
      const targeted = targetedGeneration.result;
      const fullRequired =
        context.currentThesis === null ||
        context.event.action === 'FULL_ANALYSIS' ||
        context.event.action === 'IMMEDIATE_ANALYSIS' ||
        targeted.reanalysisRequired;
      const fullGeneration = fullRequired
        ? await this.ollama.generateStructuredWithMetrics(
            fullPrompt(item, context, targeted),
            fullJsonSchema,
            fullStockAnalysisSchema,
            signal,
            { numPredict: this.fullAnalysisNumPredict },
          )
        : null;
      const full = fullGeneration?.result ?? null;
      const display = full ?? fallbackAnalysis(context, targeted);
      const scored = buildNextThesisState(context, targeted, full);
      const decision = full?.decisionInputs
        ? evaluateDecision(scored.state, full.decisionInputs)
        : null;
      const state = decision
        ? { ...scored.state, verdict: decision.recommendation, decision }
        : scored.state;
      return {
        status: 'SUCCESS',
        metrics: {
          durationMs:
            (targetedGeneration.metrics.durationMs ?? 0) +
            (fullGeneration?.metrics.durationMs ?? 0),
          llmCallCount:
            (targetedGeneration.metrics.llmCallCount ?? 1) +
            (fullGeneration?.metrics.llmCallCount ?? 0),
          promptTokens:
            (targetedGeneration.metrics.promptTokens ?? 0) +
            (fullGeneration?.metrics.promptTokens ?? 0),
          completionTokens:
            (targetedGeneration.metrics.completionTokens ?? 0) +
            (fullGeneration?.metrics.completionTokens ?? 0),
          estimatedCostUsd: 0,
        },
        result: {
          title: display.title,
          summary: display.summary,
          importance: display.importance,
          sentiment: display.sentiment,
          eventType: display.eventType,
          positives: display.positives,
          negatives: display.negatives,
          risks: display.risks,
          catalysts: display.catalysts,
          confidence: display.confidence,
          marketImpact: marketImpactFor(context, targeted),
          intelligence: {
            eventId: context.event.id,
            targeted,
            fullAnalysisPerformed: fullRequired,
            redundancyClass: scored.redundancyClass,
            redundancyMultiplier: scored.redundancyMultiplier,
            reliabilityWeight: scored.reliabilityWeight,
            state,
            decision,
          },
        },
      };
    } catch (error) {
      return {
        status: 'FAILED',
        error: errorMessage(error),
      };
    }
  }
}
