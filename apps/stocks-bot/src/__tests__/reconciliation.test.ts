import type { WatcherRunner } from '@watcher/core';
import type { WatcherStore } from '@watcher/database';
import { describe, expect, it, vi } from 'vitest';
import { StockReconciliationCoordinator } from '../reconciliation.js';

describe('StockReconciliationCoordinator', () => {
  it('runs the shared watcher pipeline and persists a partial result', async () => {
    const finishReconciliation = vi.fn(async () => undefined);
    const store = {
      claimReconciliation: vi.fn(async () => true),
      finishReconciliation,
    } as unknown as WatcherStore;
    const execute = vi.fn(async () => ({
      status: 'COMPLETED' as const,
      result: {
        fetchedCount: 4,
        newItemCount: 1,
        analyzedCount: 1,
        failedAnalysisCount: 0,
        analyses: [],
        sourceFailures: [{ source: 'NEWS', target: 'MU', message: 'HTTP 503' }],
      },
    }));
    const runner = {
      execute,
    } as unknown as WatcherRunner;
    const coordinator = new StockReconciliationCoordinator(
      store,
      runner,
      86_400_000,
    );

    const result = await coordinator.execute('config', 123n, 'SCHEDULED');

    expect(result.status).toBe('COMPLETED');
    expect(execute).toHaveBeenCalledWith('config', 123n, 'SCHEDULED');
    expect(finishReconciliation).toHaveBeenCalledWith(
      'config',
      'PARTIAL',
      86_400_000,
    );
  });

  it('does not start when reconciliation is already claimed', async () => {
    const store = {
      claimReconciliation: vi.fn(async () => false),
      finishReconciliation: vi.fn(async () => undefined),
    } as unknown as WatcherStore;
    const execute = vi.fn();
    const runner = { execute } as unknown as WatcherRunner;
    const coordinator = new StockReconciliationCoordinator(
      store,
      runner,
      86_400_000,
    );

    expect(await coordinator.execute('config', 123n, 'MANUAL')).toEqual({
      status: 'BUSY',
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
