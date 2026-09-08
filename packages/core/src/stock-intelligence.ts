import { z } from 'zod';

export const signalGroupSchema = z.enum([
  'FUNDAMENTALS',
  'EARNINGS_MOMENTUM',
  'ANALYST_ESTIMATE_REVISIONS',
  'INSIDER_ACTIVITY',
  'INSTITUTIONAL_POSITIONING',
  'OPTIONS_POSITIONING',
  'PRICE_ACTION',
  'VALUATION',
  'CATALYST_SETUP',
  'COMPETITIVE_POSITION',
  'BALANCE_SHEET_FINANCIAL_RISK',
  'MACRO_SECTOR_CONDITIONS',
  'ALTERNATIVE_DATA',
]);
export type SignalGroup = z.infer<typeof signalGroupSchema>;

export const dataAvailabilitySchema = z.enum([
  'AVAILABLE',
  'DATA_UNAVAILABLE',
  'NOT_APPLICABLE',
]);
export type DataAvailability = z.infer<typeof dataAvailabilitySchema>;

export const dataQualitySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export type DataQuality = z.infer<typeof dataQualitySchema>;

export const thesisChangeSchema = z.enum([
  'STRONGLY_IMPROVED',
  'IMPROVED',
  'UNCHANGED',
  'DETERIORATED',
  'STRONGLY_DETERIORATED',
]);
export type ThesisChange = z.infer<typeof thesisChangeSchema>;

export const informationChangeSchema = z.enum([
  'NEW_INFORMATION',
  'UPDATED_INFORMATION',
  'INVALIDATED_INFORMATION',
  'PRICE_ONLY_CHANGE',
  'NO_MEANINGFUL_CHANGE',
]);
export type InformationChange = z.infer<typeof informationChangeSchema>;

export const thesisVerdictSchema = z.enum([
  'STRONG_BUY',
  'BUY',
  'SMALL_POSITION',
  'WATCH',
  'HOLD',
  'WAIT',
  'AVOID',
  'SELL',
  'INSUFFICIENT_DATA',
]);
export type ThesisVerdict = z.infer<typeof thesisVerdictSchema>;

export const redundancyClassSchema = z.enum([
  'INDEPENDENT',
  'PARTIALLY_REDUNDANT',
  'HIGHLY_REDUNDANT',
  'DUPLICATE',
]);
export type RedundancyClass = z.infer<typeof redundancyClassSchema>;

export const numericRangeSchema = z
  .object({
    minimum: z.number(),
    maximum: z.number(),
  })
  .refine(({ minimum, maximum }) => minimum <= maximum, {
    message: 'Range minimum must not exceed maximum',
  });
export type NumericRange = z.infer<typeof numericRangeSchema>;

export const scenarioSchema = z.object({
  probabilityPercent: numericRangeSchema,
  expectedReturnPercent: numericRangeSchema,
  assumptions: z.array(z.string()),
  requiredCatalysts: z.array(z.string()),
  invalidationConditions: z.array(z.string()),
});
export type Scenario = z.infer<typeof scenarioSchema>;

export const decisionInputsSchema = z.object({
  scenarios: z.object({
    bull: scenarioSchema,
    base: scenarioSchema,
    bear: scenarioSchema,
  }),
  probabilityHigher: z.object({
    sevenDays: numericRangeSchema.nullable(),
    thirtyDays: numericRangeSchema.nullable(),
    ninetyDays: numericRangeSchema.nullable(),
    twelveMonths: numericRangeSchema.nullable(),
  }),
  pricedIn: z.object({
    classification: z.enum([
      'NOT_PRICED_IN',
      'PARTIALLY_PRICED_IN',
      'MOSTLY_PRICED_IN',
      'OVERPRICED_EXPECTATIONS',
      'UNKNOWN',
    ]),
    explanation: z.string().min(1),
  }),
  volatilityRisk: z.enum(['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN']),
  binaryCatalystExposure: z.boolean(),
  downsideExplanation: z.string().min(1),
});
export type DecisionInputs = z.infer<typeof decisionInputsSchema>;

export const decisionResultSchema = z.object({
  recommendation: thesisVerdictSchema,
  expectedValuePercent: z.number().nullable(),
  asymmetry: z.enum([
    'POOR',
    'FAIR',
    'GOOD',
    'VERY_GOOD',
    'EXCEPTIONAL',
    'INSUFFICIENT_DATA',
  ]),
  probabilityHigher: decisionInputsSchema.shape.probabilityHigher,
  scenarios: decisionInputsSchema.shape.scenarios,
  pricedIn: decisionInputsSchema.shape.pricedIn,
  maxRecommendedPositionPercent: numericRangeSchema,
  rationale: z.array(z.string()),
  humanReviewRequired: z.boolean(),
});
export type DecisionResult = z.infer<typeof decisionResultSchema>;

export const signalGroupAvailabilitySchema = z.object({
  group: signalGroupSchema,
  availability: dataAvailabilitySchema,
  weight: z.number().positive(),
  reason: z.string().min(1),
});
export type SignalGroupAvailability = z.infer<
  typeof signalGroupAvailabilitySchema
>;

export const signalGroupStateSchema = z.object({
  group: signalGroupSchema,
  score: z.number().min(-5).max(5),
  availability: dataAvailabilitySchema,
  explanation: z.string().min(1),
});
export type SignalGroupState = z.infer<typeof signalGroupStateSchema>;

export const stockThesisStateSchema = z.object({
  ticker: z.string().min(1),
  thesis: z.string().min(1),
  verdict: thesisVerdictSchema,
  confidence: z.number().min(0).max(1),
  attentionScore: z.number().int().min(0).max(100),
  bullScore: z.number().min(0),
  bearScore: z.number().min(0),
  netSignal: z.number().min(-5).max(5),
  signalGroups: z.array(signalGroupStateSchema),
  catalysts: z.array(z.string()),
  insiderConviction: z.number().min(-5).max(5).nullable(),
  pricedIn: z.enum([
    'NOT_PRICED_IN',
    'PARTIALLY_PRICED_IN',
    'MOSTLY_PRICED_IN',
    'OVERPRICED_EXPECTATIONS',
    'UNKNOWN',
  ]),
  primaryDrivers: z.array(z.string()),
  risks: z.array(z.string()),
  dataCoverage: z.number().min(0).max(100),
  dataQuality: dataQualitySchema,
  materialDataGaps: z.array(z.string()),
  decision: decisionResultSchema.nullable().optional(),
});
export type StockThesisState = z.infer<typeof stockThesisStateSchema>;

const analysisEventSchema = z.object({
  id: z.string().min(1),
  ticker: z.string().min(1),
  eventType: z.string().min(1),
  eventTypes: z.array(z.string().min(1)).default([]),
  title: z.string().min(1),
  materiality: z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'EXTREME']),
  action: z.enum([
    'STORE',
    'STATE_UPDATE',
    'TARGETED_ANALYSIS',
    'FULL_ANALYSIS',
    'IMMEDIATE_ANALYSIS',
  ]),
  direction: z.enum(['POSITIVE', 'NEGATIVE', 'MIXED', 'NEUTRAL', 'UNKNOWN']),
  magnitude: z.record(z.string(), z.unknown()),
  occurredAt: z.string().nullable(),
  firstPublicAt: z.string().nullable(),
  firstDetectedAt: z.string(),
  primaryDriverId: z.string().nullable(),
  evidence: z.object({
    source: z.string().min(1),
    sourceType: z.string().min(1),
    sourceUrl: z.string().min(1),
    primarySource: z.boolean(),
    reliability: z.number().min(0).max(1),
  }),
});

const analysisCatalystSchema = z.object({
  type: z.string().min(1),
  description: z.string().min(1),
  expectedStart: z.string().nullable(),
  expectedEnd: z.string().nullable(),
  exactDateKnown: z.boolean(),
  proximity: z.string().min(1),
  impact: z.string().min(1),
  direction: z.string().min(1),
});

const priceContextSchema = z.object({
  observedAt: z.string(),
  close: z.number(),
  dailyReturnPercent: z.number().nullable(),
  weeklyReturnPercent: z.number().nullable(),
  monthlyReturnPercent: z.number().nullable(),
  relativeVolume: z.number().nullable(),
  returnVolatilityRatio: z.number().nullable().default(null),
  gapPercent: z.number().nullable(),
  volatilityPercent: z.number().nullable(),
  unexplained: z.boolean(),
});

export const marketImpactAnalysisSchema = z.object({
  ticker: z.string().min(1),
  direction: z.enum(['bullish', 'bearish', 'mixed', 'neutral']),
  magnitude: z.enum(['low', 'medium', 'high', 'extreme']),
  confidence: z.number().min(0).max(1),
  primaryCatalyst: z.string().min(1),
  secondaryCatalysts: z.array(z.string()),
  amplifiers: z.array(z.string()).optional(),
  fundamentals: z
    .record(
      z.string(),
      z.object({
        signal: z.enum(['positive', 'negative', 'neutral']),
        details: z.string().optional(),
      }),
    )
    .optional(),
  marketReaction: z
    .object({
      dailyReturnPct: z.number().optional(),
      gapPct: z.number().optional(),
      volumeRatio: z.number().optional(),
      returnVolatilityRatio: z.number().optional(),
      abnormalMove: z.boolean(),
    })
    .optional(),
  thesisImpact: z
    .enum(['strengthens', 'weakens', 'unchanged', 'requires_review'])
    .optional(),
  summary: z.string().min(1),
});
export type MarketImpactAnalysis = z.infer<typeof marketImpactAnalysisSchema>;

export const stockAnalysisContextSchema = z.object({
  event: analysisEventSchema,
  currentThesis: stockThesisStateSchema.nullable(),
  knownCatalysts: z.array(analysisCatalystSchema),
  recentEvents: z.array(analysisEventSchema.omit({ evidence: true })),
  currentPriceContext: priceContextSchema.nullable(),
  dataAvailability: z.array(signalGroupAvailabilitySchema),
  dataCoverage: z.number().min(0).max(100),
  dataQuality: dataQualitySchema,
  materialDataGaps: z.array(z.string()),
  insiderConviction: z.number().min(-5).max(5).nullable(),
});
export type StockAnalysisContext = z.infer<typeof stockAnalysisContextSchema>;

export const targetedSignalSchema = z.object({
  group: signalGroupSchema,
  score: z.number().min(-5).max(5),
  availability: dataAvailabilitySchema,
  explanation: z.string().min(1),
});

export const targetedStockAnalysisSchema = z.object({
  materiality: z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'EXTREME']),
  thesisChange: thesisChangeSchema,
  informationChange: informationChangeSchema,
  reanalysisRequired: z.boolean().default(false),
  affectedSignalGroups: z.array(targetedSignalSchema).default([]),
  catalystChange: z
    .enum(['ADDED', 'UPDATED', 'REMOVED', 'UNCHANGED'])
    .catch('UNCHANGED'),
  recommendationChange: z.boolean().default(false),
  primaryDriver: z.string().min(1),
  explanation: z.string().min(1),
  risks: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});
export type TargetedStockAnalysis = z.infer<typeof targetedStockAnalysisSchema>;

export const fullStockAnalysisSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  importance: z.number().int().min(1).max(10),
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  eventType: z.string().min(1),
  positives: z.array(z.string()),
  negatives: z.array(z.string()),
  risks: z.array(z.string()),
  catalysts: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  thesis: z.string().min(1),
  verdict: z.enum(['WATCH', 'WAIT', 'INSUFFICIENT_DATA']),
  attentionScore: z.number().int().min(0).max(100),
  primaryDrivers: z.array(z.string()),
  pricedIn: z.enum([
    'NOT_PRICED_IN',
    'PARTIALLY_PRICED_IN',
    'MOSTLY_PRICED_IN',
    'OVERPRICED_EXPECTATIONS',
    'UNKNOWN',
  ]),
  decisionInputs: decisionInputsSchema.optional(),
});
export type FullStockAnalysis = z.infer<typeof fullStockAnalysisSchema>;

export const stockIntelligenceResultSchema = z.object({
  eventId: z.string().min(1),
  targeted: targetedStockAnalysisSchema,
  fullAnalysisPerformed: z.boolean(),
  redundancyClass: redundancyClassSchema,
  redundancyMultiplier: z.number().min(0).max(1),
  reliabilityWeight: z.number().positive(),
  state: stockThesisStateSchema,
  decision: decisionResultSchema.nullable().optional(),
});
export type StockIntelligenceResult = z.infer<
  typeof stockIntelligenceResultSchema
>;
