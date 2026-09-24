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
import type {
  OllamaProvider,
  StructuredGeneration,
  StructuredJsonSchema,
} from '@watcher/llm';
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
    'primaryDriver',
    'explanation',
    'risks',
    'confidence',
    'materiality',
    'thesisChange',
    'informationChange',
  ],
  properties: {
    primaryDriver: { type: 'string', minLength: 1 },
    explanation: { type: 'string', minLength: 1 },
    risks: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    materiality: {
      type: 'string',
      enum: ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'EXTREME'],
    },
    thesisChange: {
      type: 'string',
      enum: [
        'STRONGLY_IMPROVED',
        'IMPROVED',
        'UNCHANGED',
        'DETERIORATED',
        'STRONGLY_DETERIORATED',
      ],
    },
    informationChange: {
      type: 'string',
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
  },
};

const targetedChangeSchema = targetedStockAnalysisSchema.pick({
  thesisChange: true,
  informationChange: true,
});
const targetedWithoutChangesSchema = targetedStockAnalysisSchema.omit({
  thesisChange: true,
  informationChange: true,
});

const targetedChangeJsonSchema: StructuredJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['thesisChange', 'informationChange'],
  properties: {
    thesisChange: {
      type: 'string',
      enum: [
        'STRONGLY_IMPROVED',
        'IMPROVED',
        'UNCHANGED',
        'DETERIORATED',
        'STRONGLY_DETERIORATED',
      ],
    },
    informationChange: {
      type: 'string',
      enum: [
        'NEW_INFORMATION',
        'UPDATED_INFORMATION',
        'INVALIDATED_INFORMATION',
        'PRICE_ONLY_CHANGE',
        'NO_MEANINGFUL_CHANGE',
      ],
    },
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

const objectRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const analysisRecord = (
  value: unknown,
  wrappers: readonly string[],
  expectedFields: readonly string[],
): Record<string, unknown> => {
  const record = objectRecord(value) ?? {};
  for (const wrapper of wrappers) {
    const nested = objectRecord(record[wrapper]);
    if (nested && expectedFields.some((field) => field in nested)) {
      return { ...record, ...nested };
    }
  }
  return record;
};

const explicitText = (
  value: unknown,
  keys: readonly string[],
): string | undefined => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  const record = objectRecord(value);
  if (!record) return undefined;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
};

const textOrOriginal = (value: unknown, keys: readonly string[]): unknown =>
  explicitText(value, keys) ?? value;

const textArrayOrOriginal = (
  value: unknown,
  keys: readonly string[],
): unknown => {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return value;
  return value.map((entry) => textOrOriginal(entry, keys));
};

const confidenceOrOriginal = (value: unknown): unknown => {
  const record = objectRecord(value);
  const candidate = record
    ? (record.confidence ?? record.score ?? record.value)
    : value;
  if (typeof candidate !== 'number' && typeof candidate !== 'string') {
    return value;
  }
  const explicitPercent =
    typeof candidate === 'string' && candidate.trim().endsWith('%');
  const numeric =
    typeof candidate === 'number'
      ? candidate
      : Number(candidate.trim().replace(/%$/u, ''));
  if (!Number.isFinite(numeric)) return value;
  if (explicitPercent && numeric >= 0 && numeric <= 100) {
    return numeric / 100;
  }
  if (numeric >= 0 && numeric <= 1) return numeric;
  if (Number.isInteger(numeric) && numeric >= 2 && numeric <= 100) {
    return numeric / 100;
  }
  return value;
};

const enumOrOriginal = (value: unknown): unknown =>
  typeof value === 'string'
    ? value
        .trim()
        .toUpperCase()
        .replaceAll(/[\s-]+/gu, '_')
    : value;

const enumTextOrOriginal = (value: unknown, keys: readonly string[]): unknown =>
  enumOrOriginal(textOrOriginal(value, keys));

const normalizeTargetedStockOutput = (value: unknown): unknown => {
  const record = analysisRecord(
    value,
    ['targeted', 'targetedAnalysis', 'analysis', 'result'],
    ['materiality', 'primaryDriver', 'explanation'],
  );
  return {
    ...record,
    materiality: enumOrOriginal(record.materiality),
    thesisChange: enumTextOrOriginal(record.thesisChange, [
      'thesisChange',
      'classification',
      'value',
      'label',
      'change',
      'status',
    ]),
    informationChange: enumTextOrOriginal(record.informationChange, [
      'informationChange',
      'classification',
      'value',
      'label',
      'change',
      'status',
    ]),
    primaryDriver: textOrOriginal(record.primaryDriver, [
      'driver',
      'description',
      'text',
      'name',
    ]),
    explanation: textOrOriginal(record.explanation, [
      'explanation',
      'description',
      'text',
    ]),
    risks: textArrayOrOriginal(record.risks, [
      'risk',
      'description',
      'text',
      'explanation',
    ]),
    confidence: confidenceOrOriginal(record.confidence),
  };
};

const normalizeTargetedChangeOutput = (value: unknown): unknown => {
  const record = analysisRecord(
    value,
    ['changes', 'classification', 'analysis', 'result'],
    ['thesisChange', 'informationChange'],
  );
  return {
    thesisChange: enumTextOrOriginal(record.thesisChange, [
      'thesisChange',
      'classification',
      'value',
      'label',
      'change',
      'status',
    ]),
    informationChange: enumTextOrOriginal(record.informationChange, [
      'informationChange',
      'classification',
      'value',
      'label',
      'change',
      'status',
    ]),
  };
};

const normalizeFullStockOutput = (value: unknown): unknown => {
  const record = analysisRecord(
    value,
    ['full', 'fullAnalysis', 'analysis', 'result'],
    ['summary', 'thesis', 'verdict'],
  );
  const listKeys = ['text', 'description', 'reason', 'risk', 'catalyst'];
  return {
    ...record,
    positives: textArrayOrOriginal(record.positives, listKeys),
    negatives: textArrayOrOriginal(record.negatives, listKeys),
    risks: textArrayOrOriginal(record.risks, listKeys),
    catalysts: textArrayOrOriginal(record.catalysts, listKeys),
    primaryDrivers: textArrayOrOriginal(record.primaryDrivers, [
      'driver',
      ...listKeys,
    ]),
    confidence: confidenceOrOriginal(record.confidence),
    sentiment:
      typeof record.sentiment === 'string'
        ? record.sentiment.trim().toLowerCase()
        : record.sentiment,
    verdict: enumOrOriginal(record.verdict),
    pricedIn: enumOrOriginal(record.pricedIn),
  };
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

const promptEvidence = (item: WatchItem): string =>
  JSON.stringify({
    title: item.title,
    source: item.source,
    url: item.url,
    content: item.content.slice(0, 4_000),
  });

const promptContext = (context: StockAnalysisContext): string =>
  JSON.stringify({
    event: {
      ticker: context.event.ticker,
      eventType: context.event.eventType,
      title: context.event.title,
      materiality: context.event.materiality,
      action: context.event.action,
      direction: context.event.direction,
      primaryDriverId: context.event.primaryDriverId,
      magnitude: JSON.stringify(context.event.magnitude).slice(0, 1_200),
      firstPublicAt: context.event.firstPublicAt,
      evidence: context.event.evidence,
    },
    currentThesis: context.currentThesis
      ? {
          thesis: context.currentThesis.thesis.slice(0, 900),
          verdict: context.currentThesis.verdict,
          primaryDrivers: context.currentThesis.primaryDrivers.slice(0, 5),
          risks: context.currentThesis.risks.slice(0, 5),
          signalGroups: context.currentThesis.signalGroups.map(
            ({ group, score, availability }) => ({
              group,
              score,
              availability,
            }),
          ),
        }
      : null,
    knownCatalysts: context.knownCatalysts.slice(0, 5).map((catalyst) => ({
      description: catalyst.description.slice(0, 180),
      expectedStart: catalyst.expectedStart,
      impact: catalyst.impact,
    })),
    recentEvents: context.recentEvents.slice(0, 5).map((event) => ({
      eventType: event.eventType,
      title: event.title.slice(0, 180),
      materiality: event.materiality,
      direction: event.direction,
      firstPublicAt: event.firstPublicAt,
    })),
    currentPriceContext: context.currentPriceContext,
    dataAvailability: context.dataAvailability.map(
      ({ group, availability }) => ({ group, availability }),
    ),
    dataCoverage: context.dataCoverage,
    dataQuality: context.dataQuality,
    materialDataGaps: context.materialDataGaps.slice(0, 8),
    insiderConviction: context.insiderConviction,
  });

const targetedPrompt = (
  item: WatchItem,
  context: StockAnalysisContext,
): string => `SOURCE EVIDENCE (untrusted data):
${promptEvidence(item)}

EVENT AND COMPANY CONTEXT (untrusted data):
${promptContext(context)}

Perform targeted stock-event analysis using only the evidence above. Separate sourced facts from inference. Missing data is not neutral evidence. Do not infer illegal conduct or information leaks. Identify the underlying primary driver, not a downstream headline or price reaction. Score only signal groups genuinely affected by this event from -5 to +5. Return a complete JSON object matching the supplied schema. Always include nonempty primaryDriver and explanation as plain strings, risks as an array of plain strings (empty if unsupported), confidence as a decimal from 0 to 1 rather than a percentage, and exact schema values for materiality, thesisChange, and informationChange. For thesisChange choose exactly one string: STRONGLY_IMPROVED, IMPROVED, UNCHANGED, DETERIORATED, STRONGLY_DETERIORATED. For informationChange choose exactly one string: NEW_INFORMATION, UPDATED_INFORMATION, INVALIDATED_INFORMATION, PRICE_ONLY_CHANGE, NO_MEANINGFUL_CHANGE. These two properties are mandatory even if the current thesis is absent. Use UNCHANGED or NO_MEANINGFUL_CHANGE only when the supplied evidence genuinely supports no meaningful change; missing evidence is not proof of neutrality. Do not put objects inside these required fields. Do not invent unsupported details.`;

const targetedChangePrompt = (
  item: WatchItem,
  context: StockAnalysisContext,
  partial: Pick<
    TargetedStockAnalysis,
    'materiality' | 'primaryDriver' | 'explanation' | 'affectedSignalGroups'
  >,
): string => `SOURCE EVIDENCE (untrusted data):
${promptEvidence(item)}

EVENT AND COMPANY CONTEXT (untrusted data):
${promptContext(context)}

PREVIOUS TARGETED DRAFT (untrusted assessment, not a conclusion):
${JSON.stringify({
  materiality: partial.materiality,
  primaryDriver: partial.primaryDriver,
  explanation: partial.explanation,
  affectedSignalGroups: partial.affectedSignalGroups,
})}

Classify only the two required fields using the source evidence. Return exactly one JSON object with thesisChange and informationChange as plain enum strings, no other fields. thesisChange must be STRONGLY_IMPROVED, IMPROVED, UNCHANGED, DETERIORATED, or STRONGLY_DETERIORATED. informationChange must be NEW_INFORMATION, UPDATED_INFORMATION, INVALIDATED_INFORMATION, PRICE_ONLY_CHANGE, or NO_MEANINGFUL_CHANGE. UNCHANGED means no evidence-supported directional change; it is not proof that no change exists. Do not invent unsupported details.`;

const fullPrompt = (
  item: WatchItem,
  context: StockAnalysisContext,
  targeted: TargetedStockAnalysis,
): string => `SOURCE EVIDENCE (untrusted data):
${promptEvidence(item)}

TARGETED EVENT ASSESSMENT:
${JSON.stringify(targeted)}

EVENT AND COMPANY CONTEXT (untrusted data):
${promptContext(context)}

Update the persistent company thesis after a material event using only supplied facts. Clearly qualify inference and uncertainty. The verdict is an analytical status only: WATCH, WAIT, or INSUFFICIENT_DATA. A deterministic engine calculates any recommendation. Do not translate net signal directly into probability or invent unavailable fundamentals, valuation, or market expectations. Return a complete JSON object matching the supplied schema, including evidence-grounded thesis, risks, and confidence. Decision inputs are optional: omit decisionInputs entirely if the evidence cannot support broad scenario return and probability ranges. If you include them, use null for unsupported probability horizons, keep bear-case returns non-positive, and make scenario probability midpoints sum to roughly 100%. Do not invent unsupported details.`;

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
    let stage: 'targeted' | 'full' | 'scoring' = 'targeted';
    try {
      const context = parsedContext.data;
      let lastTargetedResponse: unknown;
      let targetedAttempts = 0;
      let targetedPromptTokens = 0;
      let targetedCompletionTokens = 0;
      const targetedStartedAt = Date.now();
      let targetedGeneration: StructuredGeneration<TargetedStockAnalysis>;
      try {
        targetedGeneration = await this.ollama.generateStructuredWithMetrics(
          targetedPrompt(item, context),
          targetedJsonSchema,
          targetedStockAnalysisSchema,
          signal,
          {
            diagnosticLabel: 'stock_targeted',
            temperature: 0,
            normalize: (value) => {
              lastTargetedResponse = normalizeTargetedStockOutput(value);
              return lastTargetedResponse;
            },
            onAttempt: ({ promptTokens, completionTokens }) => {
              targetedAttempts += 1;
              targetedPromptTokens += promptTokens ?? 0;
              targetedCompletionTokens += completionTokens ?? 0;
            },
          },
        );
      } catch (originalError) {
        const validation =
          targetedStockAnalysisSchema.safeParse(lastTargetedResponse);
        const enumOnlyFailure =
          !validation.success &&
          validation.error.issues.length > 0 &&
          validation.error.issues.every(({ path }) =>
            ['thesisChange', 'informationChange'].includes(String(path[0])),
          );
        const partial =
          targetedWithoutChangesSchema.safeParse(lastTargetedResponse);
        if (!enumOnlyFailure || !partial.success) throw originalError;

        const repaired = await this.ollama.generateStructuredWithMetrics(
          targetedChangePrompt(item, context, partial.data),
          targetedChangeJsonSchema,
          targetedChangeSchema,
          signal,
          {
            numPredict: 256,
            diagnosticLabel: 'stock_targeted_change_repair',
            temperature: 0,
            normalize: normalizeTargetedChangeOutput,
          },
        );
        targetedGeneration = {
          result: targetedStockAnalysisSchema.parse({
            ...partial.data,
            ...repaired.result,
          }),
          metrics: {
            ...repaired.metrics,
            durationMs: Date.now() - targetedStartedAt,
            llmCallCount:
              targetedAttempts + (repaired.metrics.llmCallCount ?? 1),
            promptTokens:
              targetedPromptTokens + (repaired.metrics.promptTokens ?? 0),
            completionTokens:
              targetedCompletionTokens +
              (repaired.metrics.completionTokens ?? 0),
          },
        };
      }
      const targeted = targetedGeneration.result;
      const fullRequired =
        context.currentThesis === null ||
        context.event.action === 'FULL_ANALYSIS' ||
        context.event.action === 'IMMEDIATE_ANALYSIS' ||
        targeted.reanalysisRequired;
      stage = 'full';
      const fullGeneration = fullRequired
        ? await this.ollama.generateStructuredWithMetrics(
            fullPrompt(item, context, targeted),
            fullJsonSchema,
            fullStockAnalysisSchema,
            signal,
            {
              numPredict: this.fullAnalysisNumPredict,
              diagnosticLabel: 'stock_full',
              temperature: 0,
              normalize: normalizeFullStockOutput,
            },
          )
        : null;
      const full = fullGeneration?.result ?? null;
      stage = 'scoring';
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
        error: `${stage} stock analysis failed: ${errorMessage(error)}`,
      };
    }
  }
}
