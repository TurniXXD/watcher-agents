import {
  agentOutputFeedbackSchema,
  agentRunSchema,
  type AgentTelemetryRecorder,
} from '@watcher/observability';
import {
  AgentFeedbackAction,
  AgentFeedbackConsumer,
  AgentRunStatus,
} from './generated/prisma/enums.js';
import type { DatabaseClient } from './client.js';
import { prismaJson } from './utils/json.js';

const runStatus = {
  success: AgentRunStatus.SUCCESS,
  partial: AgentRunStatus.PARTIAL,
  failed: AgentRunStatus.FAILED,
} as const;

const consumers = {
  'briefing-agent': AgentFeedbackConsumer.BRIEFING_AGENT,
  telegram: AgentFeedbackConsumer.TELEGRAM,
  user: AgentFeedbackConsumer.USER,
  other: AgentFeedbackConsumer.OTHER,
} as const;

const actions = {
  included: AgentFeedbackAction.INCLUDED,
  filtered: AgentFeedbackAction.FILTERED,
  opened: AgentFeedbackAction.OPENED,
  ignored: AgentFeedbackAction.IGNORED,
  dismissed: AgentFeedbackAction.DISMISSED,
  acted_on: AgentFeedbackAction.ACTED_ON,
  marked_useful: AgentFeedbackAction.MARKED_USEFUL,
  marked_not_useful: AgentFeedbackAction.MARKED_NOT_USEFUL,
} as const;

export class AgentTelemetryStore implements AgentTelemetryRecorder {
  public constructor(private readonly db: DatabaseClient) {}

  public async recordRun(rawRun: unknown): Promise<void> {
    const run = agentRunSchema.parse(rawRun);
    const metrics = run.metrics;
    const sourceObservedAt = run.finishedAt ?? run.startedAt;
    await this.db.agentRun.upsert({
      where: { id: run.id },
      create: {
        id: run.id,
        agentName: run.agentName,
        agentVersion: run.agentVersion ?? null,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt ?? null,
        status: runStatus[run.status],
        ...(run.input === undefined ? {} : { input: prismaJson(run.input) }),
        ...(run.output === undefined ? {} : { output: prismaJson(run.output) }),
        ...(run.error === undefined ? {} : { error: prismaJson(run.error) }),
        latencyMs: metrics?.latencyMs ?? null,
        llmProvider: metrics?.llm?.provider ?? null,
        llmModel: metrics?.llm?.model ?? null,
        llmInputTokens: metrics?.llm?.inputTokens ?? null,
        llmOutputTokens: metrics?.llm?.outputTokens ?? null,
        llmCostUsd: metrics?.llm?.costUsd ?? null,
        itemsFetched: metrics?.itemsFetched ?? null,
        itemsProduced: metrics?.itemsProduced ?? null,
        itemsFiltered: metrics?.itemsFiltered ?? null,
        duplicatesRemoved: metrics?.duplicatesRemoved ?? null,
        ...(run.metadata === undefined
          ? {}
          : { metadata: prismaJson(run.metadata) }),
        sources: {
          create: (run.sources ?? []).map((source) => ({
            sourceId: source.sourceId,
            url: source.url ?? null,
            status: source.status,
            latencyMs: source.latencyMs ?? null,
            itemCount: source.itemCount ?? null,
            error: source.error ?? null,
            createdAt: sourceObservedAt,
          })),
        },
      },
      update: {
        agentVersion: run.agentVersion ?? null,
        finishedAt: run.finishedAt ?? null,
        status: runStatus[run.status],
        ...(run.input === undefined ? {} : { input: prismaJson(run.input) }),
        ...(run.output === undefined ? {} : { output: prismaJson(run.output) }),
        ...(run.error === undefined ? {} : { error: prismaJson(run.error) }),
        latencyMs: metrics?.latencyMs ?? null,
        llmProvider: metrics?.llm?.provider ?? null,
        llmModel: metrics?.llm?.model ?? null,
        llmInputTokens: metrics?.llm?.inputTokens ?? null,
        llmOutputTokens: metrics?.llm?.outputTokens ?? null,
        llmCostUsd: metrics?.llm?.costUsd ?? null,
        itemsFetched: metrics?.itemsFetched ?? null,
        itemsProduced: metrics?.itemsProduced ?? null,
        itemsFiltered: metrics?.itemsFiltered ?? null,
        duplicatesRemoved: metrics?.duplicatesRemoved ?? null,
        ...(run.metadata === undefined
          ? {}
          : { metadata: prismaJson(run.metadata) }),
        sources: {
          deleteMany: {},
          create: (run.sources ?? []).map((source) => ({
            sourceId: source.sourceId,
            url: source.url ?? null,
            status: source.status,
            latencyMs: source.latencyMs ?? null,
            itemCount: source.itemCount ?? null,
            error: source.error ?? null,
            createdAt: sourceObservedAt,
          })),
        },
      },
    });
  }

  public async recordFeedback(rawFeedback: unknown): Promise<void> {
    const feedback = agentOutputFeedbackSchema.parse(rawFeedback);
    await this.db.agentOutputFeedback.create({
      data: {
        agentRunId: feedback.agentRunId,
        outputItemId: feedback.outputItemId ?? null,
        consumer: consumers[feedback.consumer],
        action: actions[feedback.action],
        reason: feedback.reason ?? null,
        createdAt: feedback.createdAt,
      },
    });
  }
}
