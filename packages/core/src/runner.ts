import type {
  PipelineResult,
  ProgressReporter,
  RunProgress,
  SourceRequest,
  WatcherKind,
} from './types.js';
import type { WatcherLogger } from './logger.js';
import type { WatcherPipeline } from './pipeline.js';
import { errorMessage } from './utils/general.js';
import type { AgentRun, AgentTelemetryRecorder } from '@watcher/observability';

export interface RunStore {
  claimRun(
    configId: string,
    trigger: 'MANUAL' | 'SCHEDULED',
  ): Promise<{ id: string } | undefined>;
  finishRun(
    configId: string,
    runId: string,
    result: {
      status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'SKIPPED';
      fetchedCount?: number;
      newItemCount?: number;
      analyzedCount?: number;
      failedAnalysisCount?: number;
      error?: string;
    },
  ): Promise<void>;
  recordSourceFailures(
    runId: string,
    failures: PipelineResult['sourceFailures'],
  ): Promise<void>;
}

export type RunExecution =
  | { status: 'BUSY' }
  | { status: 'COMPLETED'; result: PipelineResult }
  | { status: 'FAILED'; error: string; durationMs: number };

export type RunExecutionOptions = {
  onProgress?: ProgressReporter;
  signal?: AbortSignal;
  targetKeys?: ReadonlySet<string>;
  sourceIds?: ReadonlySet<string>;
};

export class WatcherRunner {
  public constructor(
    private readonly kind: WatcherKind,
    private readonly pipeline: WatcherPipeline,
    private readonly store: RunStore,
    private readonly requestsForChat: (
      chatId: bigint,
    ) => Promise<SourceRequest[]>,
    private readonly notify: (
      chatId: bigint,
      result: PipelineResult,
      manual: boolean,
    ) => Promise<void>,
    private readonly logger?: WatcherLogger,
    private readonly afterRun?: (
      chatId: bigint,
      result: PipelineResult,
      runId: string,
    ) => Promise<void>,
    private readonly afterFailure?: (
      chatId: bigint,
      error: string,
      runId: string,
    ) => Promise<void>,
    private readonly telemetry?: AgentTelemetryRecorder,
  ) {}

  private async reportProgress(
    reporter: ProgressReporter | undefined,
    progress: RunProgress,
  ): Promise<void> {
    try {
      await reporter?.(progress);
    } catch {
      // Progress feedback is best-effort and must never fail the watcher run.
    }
  }

  private async recordTelemetry(run: AgentRun): Promise<void> {
    try {
      await this.telemetry?.recordRun(run);
    } catch (error) {
      this.logger?.warn(
        { kind: this.kind, runId: run.id, err: error },
        'Watcher telemetry recording failed',
      );
    }
  }

  public async execute(
    configId: string,
    chatId: bigint,
    trigger: 'MANUAL' | 'SCHEDULED',
    options: RunExecutionOptions = {},
  ): Promise<RunExecution> {
    const run = await this.store.claimRun(configId, trigger);
    if (!run) {
      this.logger?.info(
        { kind: this.kind, configId, trigger },
        'Watcher run skipped because another run is active',
      );
      return { status: 'BUSY' };
    }
    const startedAt = Date.now();
    this.logger?.info(
      { kind: this.kind, configId, runId: run.id, trigger },
      'Watcher run started',
    );
    const onProgress = options.onProgress
      ? (progress: RunProgress) =>
          this.reportProgress(options.onProgress, progress)
      : undefined;

    try {
      await this.reportProgress(onProgress, {
        percent: 5,
        step: 'Preparing sources',
      });
      const allRequests = await this.requestsForChat(chatId);
      const requests = allRequests.filter(
        ({ source, targetKey }) =>
          (!options.targetKeys ||
            (targetKey !== undefined && options.targetKeys.has(targetKey))) &&
          (!options.sourceIds || options.sourceIds.has(source.id)),
      );
      this.logger?.info(
        {
          kind: this.kind,
          configId,
          runId: run.id,
          trigger,
          sourceRequestCount: requests.length,
        },
        'Watcher source requests prepared',
      );
      const pipelineResult = await this.pipeline.run(
        this.kind,
        run.id,
        requests,
        {
          analysisStep:
            this.kind === 'STOCKS'
              ? 'Evaluating events and thesis'
              : this.kind === 'PUBLICATIONS'
                ? 'Analyzing publications'
                : 'Analyzing news',
          ...(onProgress ? { onProgress } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
        },
      );
      const result = {
        ...pipelineResult,
        durationMs: Date.now() - startedAt,
      };
      await this.reportProgress(onProgress, {
        percent: 95,
        step: 'Recording run result',
      });
      await this.store.recordSourceFailures(run.id, result.sourceFailures);
      const partial =
        result.sourceFailures.length > 0 || result.failedAnalysisCount > 0;
      const status = partial ? 'PARTIAL' : 'SUCCESS';
      await this.store.finishRun(configId, run.id, {
        status,
        fetchedCount: result.fetchedCount,
        newItemCount: result.newItemCount,
        analyzedCount: result.analyzedCount,
        failedAnalysisCount: result.failedAnalysisCount,
      });
      await this.recordTelemetry({
        id: run.id,
        agentName:
          this.kind === 'STOCKS'
            ? 'stocks-bot'
            : this.kind === 'PUBLICATIONS'
              ? 'publications-bot'
              : 'news-bot',
        startedAt: new Date(startedAt),
        finishedAt: new Date(),
        status: status === 'SUCCESS' ? 'success' : 'partial',
        metrics: {
          latencyMs: result.durationMs,
          itemsFetched: result.fetchedCount,
          itemsProduced: result.newItemCount,
          itemsFiltered: Math.max(0, result.fetchedCount - result.newItemCount),
          duplicatesRemoved: Math.max(
            0,
            result.fetchedCount - result.newItemCount,
          ),
          llm: {
            inputTokens: result.analyses.reduce(
              (sum, analysis) =>
                sum + (analysis.outcome.metrics?.promptTokens ?? 0),
              0,
            ),
            outputTokens: result.analyses.reduce(
              (sum, analysis) =>
                sum + (analysis.outcome.metrics?.completionTokens ?? 0),
              0,
            ),
            costUsd: result.analyses.reduce(
              (sum, analysis) =>
                sum + (analysis.outcome.metrics?.estimatedCostUsd ?? 0),
              0,
            ),
          },
        },
        sources: (result.sourceRuns ?? []).map((source) => ({
          sourceId: source.source,
          status: source.status.toLowerCase(),
          latencyMs: source.durationMs,
          itemCount: source.itemCount,
          ...(source.error ? { error: source.error } : {}),
        })),
        metadata: {
          trigger,
          configId,
          failedAnalysisCount: result.failedAnalysisCount,
          llmRequestCount: result.analyses.reduce(
            (sum, analysis) =>
              sum + (analysis.outcome.metrics?.llmCallCount ?? 0),
            0,
          ),
          llmErrorCount: result.failedAnalysisCount,
        },
      });
      try {
        await this.afterRun?.(chatId, result, run.id);
      } catch (error) {
        this.logger?.error(
          { kind: this.kind, configId, runId: run.id, err: error },
          'Watcher post-run lifecycle update failed',
        );
      }
      await this.reportProgress(onProgress, {
        percent: 100,
        step: 'Complete',
      });
      if (trigger === 'MANUAL' || result.newItemCount > 0) {
        this.logger?.info(
          {
            kind: this.kind,
            configId,
            runId: run.id,
            trigger,
            manual: trigger === 'MANUAL',
          },
          'Sending watcher run notification',
        );
        await this.notify(chatId, result, trigger === 'MANUAL');
      } else {
        this.logger?.info(
          {
            kind: this.kind,
            configId,
            runId: run.id,
            trigger,
            sourceFailureCount: result.sourceFailures.length,
          },
          'Watcher run notification suppressed because no new content was found',
        );
      }
      this.logger?.info(
        {
          kind: this.kind,
          configId,
          runId: run.id,
          trigger,
          status,
          fetchedCount: result.fetchedCount,
          newItemCount: result.newItemCount,
          analyzedCount: result.analyzedCount,
          failedAnalysisCount: result.failedAnalysisCount,
          sourceFailureCount: result.sourceFailures.length,
          durationMs: result.durationMs,
        },
        'Watcher run completed',
      );
      return { status: 'COMPLETED', result };
    } catch (error) {
      const message = errorMessage(error);
      const durationMs = Date.now() - startedAt;
      this.logger?.error(
        {
          kind: this.kind,
          configId,
          runId: run.id,
          trigger,
          durationMs,
          err: error,
        },
        'Watcher run failed',
      );
      await this.store.finishRun(configId, run.id, {
        status: 'FAILED',
        error: message,
      });
      await this.recordTelemetry({
        id: run.id,
        agentName:
          this.kind === 'STOCKS'
            ? 'stocks-bot'
            : this.kind === 'PUBLICATIONS'
              ? 'publications-bot'
              : 'news-bot',
        startedAt: new Date(startedAt),
        finishedAt: new Date(),
        status: 'failed',
        error: { message },
        metrics: { latencyMs: durationMs },
        metadata: { trigger, configId },
      });
      try {
        await this.afterFailure?.(chatId, message, run.id);
      } catch (lifecycleError) {
        this.logger?.error(
          {
            kind: this.kind,
            configId,
            runId: run.id,
            err: lifecycleError,
          },
          'Watcher failure lifecycle update failed',
        );
      }
      return { status: 'FAILED', error: message, durationMs };
    }
  }
}
