import type { PipelineResult, SourceRequest, WatcherKind } from './types.js';
import type { WatcherPipeline } from './pipeline.js';

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
  | { status: 'FAILED'; error: string };

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
  ) {}

  public async execute(
    configId: string,
    chatId: bigint,
    trigger: 'MANUAL' | 'SCHEDULED',
  ): Promise<RunExecution> {
    const run = await this.store.claimRun(configId, trigger);
    if (!run) return { status: 'BUSY' };

    try {
      const requests = await this.requestsForChat(chatId);
      const result = await this.pipeline.run(this.kind, run.id, requests);
      await this.store.recordSourceFailures(run.id, result.sourceFailures);
      const partial =
        result.sourceFailures.length > 0 || result.failedAnalysisCount > 0;
      await this.store.finishRun(configId, run.id, {
        status: partial ? 'PARTIAL' : 'SUCCESS',
        fetchedCount: result.fetchedCount,
        newItemCount: result.newItemCount,
        analyzedCount: result.analyzedCount,
        failedAnalysisCount: result.failedAnalysisCount,
      });
      if (
        trigger === 'MANUAL' ||
        result.newItemCount > 0 ||
        result.sourceFailures.length > 0
      ) {
        await this.notify(chatId, result, trigger === 'MANUAL');
      }
      return { status: 'COMPLETED', result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.store.finishRun(configId, run.id, {
        status: 'FAILED',
        error: message,
      });
      return { status: 'FAILED', error: message };
    }
  }
}
