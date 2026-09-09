export type Severity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type FindingType =
  | 'RECURRING_FAILURE'
  | 'NOISY_OUTPUT'
  | 'STALE_SOURCE'
  | 'DUPLICATE_OUTPUT'
  | 'POOR_CLASSIFICATION'
  | 'HIGH_LATENCY'
  | 'HIGH_COST'
  | 'LOW_VALUE_OUTPUT'
  | 'SOURCE_DEGRADATION'
  | 'SCHEDULE_ISSUE'
  | 'CONFIGURATION_ISSUE'
  | 'OTHER';

export type FeedbackObservation = {
  action: string;
  reason?: string | null;
};

export type SourceObservation = {
  sourceId: string;
  status: string;
  latencyMs?: number | null;
  itemCount?: number | null;
  error?: string | null;
  createdAt: Date;
};

export type RunObservation = {
  id: string;
  agentName: string;
  startedAt: Date;
  finishedAt?: Date | null;
  status: string;
  latencyMs?: number | null;
  llmInputTokens?: number | null;
  llmOutputTokens?: number | null;
  llmCostUsd?: number | null;
  itemsFetched?: number | null;
  itemsProduced?: number | null;
  itemsFiltered?: number | null;
  duplicatesRemoved?: number | null;
  error?: unknown;
  metadata?: unknown;
  sources: SourceObservation[];
  feedback: FeedbackObservation[];
};

export type SourceHealth = {
  agentName: string;
  sourceId: string;
  windowStartedAt: Date;
  windowEndedAt: Date;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  successRate: number;
  lastSuccessfulAt?: Date;
  lastNewItemAt?: Date;
  averageLatencyMs?: number;
  consecutiveFailures: number;
  itemsProduced: number;
  uniqueItemsProduced: number;
  duplicateRate?: number;
  staleDays?: number;
  historicalMedianUpdateDays?: number;
};

export type Finding = {
  fingerprint: string;
  agentName: string;
  type: FindingType;
  severity: Severity;
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  confidence: number;
  detectedAt: Date;
  recommendation: {
    type:
      | 'PROMPT_CHANGE'
      | 'SOURCE_CHANGE'
      | 'SCRAPER_CHANGE'
      | 'CONFIG_CHANGE'
      | 'THRESHOLD_CHANGE'
      | 'SCHEDULE_CHANGE'
      | 'MODEL_CHANGE'
      | 'CODE_CHANGE'
      | 'REMOVE_SOURCE'
      | 'ADD_SOURCE'
      | 'OTHER';
    title: string;
    rationale: string;
    expectedImpact?: string;
    risk?: string;
    proposal?: Record<string, unknown>;
  };
};

export interface MaintenanceAnalyzer {
  analyze(context: { runs: RunObservation[]; now: Date }): Promise<Finding[]>;
}
