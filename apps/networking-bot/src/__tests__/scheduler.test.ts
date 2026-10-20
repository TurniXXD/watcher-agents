import type { SocialsStore } from '@watcher/database';
import { describe, expect, it, vi } from 'vitest';
import { NetworkingScheduler } from '../scheduler.js';

describe('NetworkingScheduler', () => {
  it('reports a failed database tick without rejecting or wedging the scheduler', async () => {
    const databaseError = new Error('database unavailable');
    const store = {
      listSettings: vi
        .fn()
        .mockRejectedValueOnce(databaseError)
        .mockResolvedValueOnce([]),
      claimDueJobs: vi.fn().mockResolvedValue([]),
    };
    const logger = { error: vi.fn() };
    const scheduler = new NetworkingScheduler({
      store: store as unknown as SocialsStore,
      transport: { send: vi.fn() },
      intervalMs: 30_000,
      defaultTimezone: 'Europe/Prague',
      logger,
    });

    await expect(scheduler.tick()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      { err: databaseError },
      'Networking scheduler tick failed',
    );

    await expect(scheduler.tick()).resolves.toBeUndefined();
    expect(store.listSettings).toHaveBeenCalledTimes(2);
    expect(store.claimDueJobs).toHaveBeenCalledTimes(1);
  });
});
