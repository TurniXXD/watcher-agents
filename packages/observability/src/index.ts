import { z } from 'zod';

export const agentRunStatusSchema = z.enum(['success', 'partial', 'failed']);
export const feedbackConsumerSchema = z.enum([
  'briefing-agent',
  'telegram',
  'user',
  'other',
]);
export const feedbackActionSchema = z.enum([
  'included',
  'filtered',
  'opened',
  'ignored',
  'dismissed',
  'acted_on',
  'marked_useful',
  'marked_not_useful',
]);

export const agentSourceRunSchema = z.object({
  sourceId: z.string().min(1),
  url: z.url().optional(),
  status: z.string().min(1),
  latencyMs: z.number().int().nonnegative().optional(),
  itemCount: z.number().int().nonnegative().optional(),
  error: z.string().min(1).optional(),
});

export const agentRunSchema = z.object({
  id: z.string().min(1),
  agentName: z.string().min(1),
  agentVersion: z.string().min(1).optional(),
  startedAt: z.date(),
  finishedAt: z.date().optional(),
  status: agentRunStatusSchema,
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  error: z
    .object({
      type: z.string().optional(),
      message: z.string().min(1),
      stack: z.string().optional(),
    })
    .optional(),
  metrics: z
    .object({
      latencyMs: z.number().int().nonnegative().optional(),
      llm: z
        .object({
          provider: z.string().optional(),
          model: z.string().optional(),
          inputTokens: z.number().int().nonnegative().optional(),
          outputTokens: z.number().int().nonnegative().optional(),
          costUsd: z.number().nonnegative().optional(),
        })
        .optional(),
      itemsFetched: z.number().int().nonnegative().optional(),
      itemsProduced: z.number().int().nonnegative().optional(),
      itemsFiltered: z.number().int().nonnegative().optional(),
      duplicatesRemoved: z.number().int().nonnegative().optional(),
    })
    .optional(),
  sources: z.array(agentSourceRunSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const agentOutputFeedbackSchema = z.object({
  agentRunId: z.string().min(1),
  outputItemId: z.string().min(1).optional(),
  consumer: feedbackConsumerSchema,
  action: feedbackActionSchema,
  reason: z.string().optional(),
  createdAt: z.date().default(() => new Date()),
});

export type AgentRun = z.infer<typeof agentRunSchema>;
export type AgentSourceRun = z.infer<typeof agentSourceRunSchema>;
export type AgentOutputFeedback = z.infer<typeof agentOutputFeedbackSchema>;

export const metricNames = {
  runs: 'agent_runs_total',
  runDuration: 'agent_run_duration_seconds',
  errors: 'agent_errors_total',
  itemsFound: 'agent_items_found_total',
  itemsAccepted: 'agent_items_accepted_total',
  itemsRejected: 'agent_items_rejected_total',
  duplicates: 'agent_duplicates_total',
  sourceRequests: 'agent_source_requests_total',
  sourceErrors: 'agent_source_errors_total',
  sourceDuration: 'agent_source_duration_seconds',
  llmRequests: 'agent_llm_requests_total',
  llmErrors: 'agent_llm_errors_total',
  llmTokens: 'agent_llm_tokens_total',
  llmCost: 'agent_llm_cost_total',
} as const;

export interface AgentTelemetryRecorder {
  recordRun(run: AgentRun): Promise<void>;
  recordFeedback(feedback: AgentOutputFeedback): Promise<void>;
}

export class NoopAgentTelemetryRecorder implements AgentTelemetryRecorder {
  public recordRun(run: AgentRun): Promise<void> {
    void run;
    return Promise.resolve();
  }

  public recordFeedback(feedback: AgentOutputFeedback): Promise<void> {
    void feedback;
    return Promise.resolve();
  }
}
