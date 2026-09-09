import { AgentTelemetryStore } from './agent-telemetry-store.js';
import type { DatabaseClient } from './client.js';
import { jsonObject } from './utils/json.js';

const status = (value: string): 'success' | 'partial' | 'failed' =>
  value === 'SUCCESS' ? 'success' : value === 'FAILED' ? 'failed' : 'partial';

const duration = (startedAt: Date, finishedAt: Date | null): number | undefined =>
  finishedAt ? Math.max(0, finishedAt.getTime() - startedAt.getTime()) : undefined;

export class LegacyTelemetryImporter {
  readonly #telemetry: AgentTelemetryStore;

  public constructor(private readonly db: DatabaseClient) {
    this.#telemetry = new AgentTelemetryStore(db);
  }

  public async importSince(since: Date): Promise<number> {
    const [watcherRuns, briefingRuns, muRuns, brnoRuns] = await Promise.all([
      this.db.watcherRun.findMany({
        where: {
          startedAt: { gte: since },
          finishedAt: { not: null },
          status: { in: ['SUCCESS', 'PARTIAL', 'FAILED'] },
        },
        include: {
          watcherConfig: { include: { chatConfig: true } },
          sourceFailures: true,
          analyses: true,
        },
      }),
      this.db.briefingRun.findMany({
        where: { startedAt: { gte: since }, completedAt: { not: null } },
        include: { feedback: true },
      }),
      this.db.muMonitorRun.findMany({
        where: { startedAt: { gte: since }, finishedAt: { not: null } },
        include: { sourceRuns: true },
      }),
      this.db.brnoEventSourceRun.findMany({ where: { startedAt: { gte: since } } }),
    ]);

    for (const run of watcherRuns) {
      const promptTokens = run.analyses.reduce(
        (sum, item) => sum + (item.promptTokens ?? 0),
        0,
      );
      const completionTokens = run.analyses.reduce(
        (sum, item) => sum + (item.completionTokens ?? 0),
        0,
      );
      const cost = run.analyses.reduce(
        (sum, item) => sum + Number(item.estimatedCostUsd),
        0,
      );
      const agentName =
        run.watcherConfig.chatConfig.kind === 'STOCKS'
          ? 'stocks-bot'
          : run.watcherConfig.chatConfig.kind === 'PUBLICATIONS'
            ? 'publications-bot'
            : 'news-bot';
      await this.#telemetry.recordRun({
        id: run.id,
        agentName,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt ?? undefined,
        status: status(run.status),
        error: run.error ? { message: run.error } : undefined,
        metrics: {
          latencyMs: duration(run.startedAt, run.finishedAt),
          itemsFetched: run.fetchedCount,
          itemsProduced: run.newItemCount,
          itemsFiltered: Math.max(0, run.fetchedCount - run.newItemCount),
          llm: {
            inputTokens: promptTokens,
            outputTokens: completionTokens,
            costUsd: cost,
          },
        },
        sources: run.sourceFailures.map((failure) => ({
          sourceId: failure.source,
          status: 'failed',
          error: failure.message,
        })),
        metadata: {
          trigger: run.trigger,
          failedAnalysisCount: run.failedAnalysisCount,
          llmRequestCount: run.analyses.reduce(
            (sum, item) => sum + item.llmCallCount,
            0,
          ),
          llmErrorCount: run.analyses.filter((item) => item.status === 'FAILED')
            .length,
        },
      });
    }

    for (const run of briefingRuns) {
      const metrics = run.metrics ? jsonObject(run.metrics) : {};
      await this.#telemetry.recordRun({
        id: run.id,
        agentName: 'briefing-bot',
        startedAt: run.startedAt,
        finishedAt: run.completedAt ?? undefined,
        status: status(run.status),
        error: run.failureReason ? { message: run.failureReason } : undefined,
        metrics: {
          latencyMs: duration(run.startedAt, run.completedAt),
          itemsProduced: run.selectedStoryIds.length,
          itemsFetched:
            typeof metrics['candidateStoryCount'] === 'number'
              ? metrics['candidateStoryCount']
              : undefined,
          itemsFiltered:
            typeof metrics['candidateStoryCount'] === 'number'
              ? Math.max(0, metrics['candidateStoryCount'] - run.selectedStoryIds.length)
              : undefined,
        },
        metadata: { type: run.type, ...metrics },
      });
      if (run.feedback) {
        const existing = await this.db.agentOutputFeedback.findFirst({
          where: {
            agentRunId: run.id,
            consumer: 'USER',
            reason: run.feedback.rating,
          },
        });
        if (!existing) {
          await this.db.agentOutputFeedback.create({
            data: {
              agentRunId: run.id,
              consumer: 'USER',
              action:
                run.feedback.rating === 'USEFUL'
                  ? 'MARKED_USEFUL'
                  : 'MARKED_NOT_USEFUL',
              reason: run.feedback.rating,
              createdAt: run.feedback.createdAt,
            },
          });
        }
      }
    }

    for (const run of muRuns) {
      await this.#telemetry.recordRun({
        id: run.id,
        agentName: 'mu-clubs-monitor',
        startedAt: run.startedAt,
        finishedAt: run.finishedAt ?? undefined,
        status: status(run.status),
        error: run.error ? { message: run.error } : undefined,
        metrics: {
          latencyMs: duration(run.startedAt, run.finishedAt),
          itemsFetched: run.fetchedCount,
          itemsProduced: run.activityCount,
        },
        sources: run.sourceRuns.map((source) => ({
          sourceId: source.sourceId,
          status: source.success ? 'success' : 'failed',
          latencyMs: source.durationMs,
          itemCount: source.itemCount,
          error: source.error ?? undefined,
        })),
        metadata: { trigger: run.trigger },
      });
    }

    for (const run of brnoRuns) {
      await this.#telemetry.recordRun({
        id: `brno:${run.id}`,
        agentName: 'brno-events-agent',
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        status: run.success ? 'success' : 'failed',
        error: run.error ? { message: run.error } : undefined,
        metrics: {
          latencyMs: run.durationMs,
          itemsFetched: run.fetched,
          itemsProduced: run.created + run.updated,
          duplicatesRemoved: run.duplicates,
        },
        sources: [
          {
            sourceId: run.sourceId,
            status: run.success ? 'success' : 'failed',
            latencyMs: run.durationMs,
            itemCount: run.fetched,
            error: run.error ?? undefined,
          },
        ],
      });
    }
    return watcherRuns.length + briefingRuns.length + muRuns.length + brnoRuns.length;
  }
}
