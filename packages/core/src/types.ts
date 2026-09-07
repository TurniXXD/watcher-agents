import { z } from 'zod';
import { stockIntelligenceResultSchema } from './stock-intelligence.js';
import { removeNullBytesDeep } from './utils/general.js';

export type SourceCapabilities = {
  sourceName: string;
  sourceType:
    | 'REGULATORY'
    | 'INVESTOR_RELATIONS'
    | 'NEWS'
    | 'MARKET_DATA'
    | 'ANALYST'
    | 'PUBLICATION'
    | 'OTHER';
  minimumIntervalMs: number;
  preferredIntervalMs: number;
  maximumIntervalMs: number;
  supportsStreaming: boolean;
  costPerRequestUsd: number;
  rateLimitPerMinute: number | null;
  priority: number;
  requestPolicy?: {
    providerKey?: string;
    maxConcurrency: number;
    minimumSpacingMs: number;
    sharedRateLimitBackoff: boolean;
  };
};

export type RunEventSummary = {
  eventId: string;
  ticker: string;
  eventType: string;
  title: string;
  sourceUrl?: string | null;
  materiality: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  action:
    | 'STORE'
    | 'STATE_UPDATE'
    | 'TARGETED_ANALYSIS'
    | 'FULL_ANALYSIS'
    | 'IMMEDIATE_ANALYSIS';
  decision: 'ANALYZE' | 'STORED' | 'DUPLICATE' | 'COOLDOWN';
  direction?: 'POSITIVE' | 'NEGATIVE' | 'MIXED' | 'NEUTRAL' | 'UNKNOWN';
  magnitude?: Record<string, unknown>;
};

export type RunIntelligenceSummary = {
  events: RunEventSummary[];
  newEventCount: number;
  duplicateEventCount: number;
  storedOnlyCount: number;
  cooldownCount: number;
};

export const watcherKindSchema = z.enum(['STOCKS', 'PUBLICATIONS', 'NEWS']);
export type WatcherKind = z.infer<typeof watcherKindSchema>;

export const watchItemSchema = z.preprocess(
  removeNullBytesDeep,
  z.object({
    id: z.string().min(1),
    source: z.string().min(1),
    externalId: z.string().min(1),
    title: z.string().min(1),
    url: z.url(),
    publishedAt: z.date().optional(),
    content: z.string().min(1),
    sourceType: z
      .enum([
        'REGULATORY',
        'INVESTOR_RELATIONS',
        'NEWS',
        'MARKET_DATA',
        'ANALYST',
        'PUBLICATION',
        'OTHER',
      ])
      .optional(),
    primarySource: z.boolean().optional(),
    eventAt: z.date().optional(),
    category: z.string().min(1).optional(),
    normalizedFacts: z.record(z.string(), z.unknown()).optional(),
    entities: z.array(z.string()).optional(),
    reliability: z.number().min(0).max(1).optional(),
    metadata: z.record(z.string(), z.unknown()),
  }),
);

export type WatchItem = z.infer<typeof watchItemSchema>;

export type SourceFailure = {
  source: string;
  target: string;
  message: string;
};

export type SourceRequest<TConfig = unknown> = {
  source: Source<TConfig>;
  target: string;
  targetKey?: string;
  config: TConfig;
};

export type RunProgress = {
  percent: number;
  step: string;
};

export type ProgressReporter = (progress: RunProgress) => Promise<void> | void;

export interface Source<TConfig = unknown> {
  readonly id: string;
  readonly capabilities?: SourceCapabilities;
  fetch(config: TConfig, signal?: AbortSignal): Promise<WatchItem[]>;
}

export const stockAnalysisSchema = z.object({
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
  intelligence: stockIntelligenceResultSchema.optional(),
});

export type StockAnalysis = z.infer<typeof stockAnalysisSchema>;

export const publicationAnalysisSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  importance: z.number().int().min(1).max(10),
  relevance: z.number().int().min(1).max(10),
  keyFindings: z.array(z.string()),
  methods: z.array(z.string()),
  limitations: z.array(z.string()),
  whyInteresting: z.string(),
  confidence: z.number().min(0).max(1),
});

export type PublicationAnalysis = z.infer<typeof publicationAnalysisSchema>;

export const newsAnalysisSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  importance: z.number().int().min(1).max(10),
  relevance: z.number().int().min(1).max(10),
  category: z.enum([
    'POLITICS',
    'BUSINESS',
    'ECONOMY',
    'TECHNOLOGY',
    'SCIENCE',
    'HEALTH',
    'SECURITY',
    'CLIMATE',
    'CULTURE',
    'SPORT',
    'OTHER',
  ]),
  keyFacts: z.array(z.string()),
  whyItMatters: z.string().min(1),
  entities: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export type NewsAnalysis = z.infer<typeof newsAnalysisSchema>;
export type WatchAnalysis = StockAnalysis | PublicationAnalysis | NewsAnalysis;

export type AnalysisMetrics = {
  durationMs?: number;
  llmCallCount?: number;
  promptTokens?: number;
  completionTokens?: number;
  estimatedCostUsd?: number;
};

export type AnalysisOutcome =
  | { status: 'SUCCESS'; result: WatchAnalysis; metrics?: AnalysisMetrics }
  | { status: 'FAILED'; error: string; metrics?: AnalysisMetrics };

export interface Analyzer {
  analyze(
    kind: WatcherKind,
    item: WatchItem,
    signal?: AbortSignal,
  ): Promise<AnalysisOutcome>;
}

export type PreparedItem = {
  recordId: string;
  item: WatchItem;
  outcome?: AnalysisOutcome;
};

export type SourceAttemptDecision = {
  allowed: boolean;
  retryAt?: Date;
  status?: 'HEALTHY' | 'DEGRADED' | 'RATE_LIMITED' | 'UNAVAILABLE';
};

export type SourceHealthContext = {
  providerKey?: string;
  sharedRateLimitBackoff?: boolean;
  rateLimited?: boolean;
  retryAt?: Date;
};

export interface PipelineRepository {
  prepareItemsForRun(
    kind: WatcherKind,
    runId: string,
    items: WatchItem[],
    maxAnalyses: number,
  ): Promise<PreparedItem[]>;
  saveAnalysis(
    runId: string,
    itemId: string,
    outcome: AnalysisOutcome,
  ): Promise<void>;
  sourceAttemptDecision?(
    kind: WatcherKind,
    runId: string,
    source: string,
    target: string,
    now: Date,
    context?: SourceHealthContext,
  ): Promise<SourceAttemptDecision>;
  recordSourceSuccess?(
    kind: WatcherKind,
    runId: string,
    source: string,
    target: string,
    now: Date,
    context?: SourceHealthContext,
  ): Promise<void>;
  recordSourceFailure?(
    kind: WatcherKind,
    runId: string,
    source: string,
    target: string,
    message: string,
    now: Date,
    context?: SourceHealthContext,
  ): Promise<void>;
  getRunIntelligenceSummary?(
    runId: string,
  ): Promise<RunIntelligenceSummary | undefined>;
}

export type AnalyzedItem = {
  item: WatchItem;
  outcome: AnalysisOutcome;
};

export type PipelineResult = {
  durationMs?: number;
  fetchedCount: number;
  newItemCount: number;
  analyzedCount: number;
  failedAnalysisCount: number;
  analyses: AnalyzedItem[];
  sourceFailures: SourceFailure[];
  dataCoverage?: {
    expectedSources: number;
    successfulSources: number;
    unavailableSources: number;
    percentage: number;
  };
  intelligence?: RunIntelligenceSummary;
};
