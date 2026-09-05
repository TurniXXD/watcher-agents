import type { RunExecution, WatcherLogger, WatcherRunner } from '@watcher/core';
import type { WatcherStore } from '@watcher/database';

export class StockReconciliationCoordinator {
  public constructor(
    private readonly store: WatcherStore,
    private readonly runner: WatcherRunner,
    private readonly intervalMs: number,
    private readonly logger?: WatcherLogger,
  ) {}

  public async execute(
    configId: string,
    chatId: bigint,
    trigger: 'MANUAL' | 'SCHEDULED',
  ): Promise<RunExecution> {
    if (!(await this.store.claimReconciliation(configId))) {
      return { status: 'BUSY' };
    }

    try {
      this.logger?.info(
        { configId, trigger },
        'Daily stock reconciliation started',
      );
      const execution = await this.runner.execute(configId, chatId, trigger);
      const status =
        execution.status === 'BUSY'
          ? 'BUSY'
          : execution.status === 'FAILED'
            ? 'FAILED'
            : execution.result.sourceFailures.length > 0 ||
                execution.result.failedAnalysisCount > 0
              ? 'PARTIAL'
              : 'SUCCESS';
      await this.store.finishReconciliation(configId, status, this.intervalMs);
      this.logger?.info(
        { configId, trigger, status },
        'Daily stock reconciliation completed',
      );
      return execution;
    } catch (error) {
      await this.store.finishReconciliation(
        configId,
        'FAILED',
        this.intervalMs,
      );
      this.logger?.error(
        { configId, trigger, err: error },
        'Daily stock reconciliation failed',
      );
      throw error;
    }
  }
}
