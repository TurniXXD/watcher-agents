import { describe, expect, it, vi } from 'vitest';
import type { WatcherLogger } from '@watcher/core';
import {
  MaintenanceScheduler,
  maintenanceSchedulerLease,
} from '../scheduler.js';

const settings = {
  enabled: true,
  tickMs: 30_000,
  healthMinutes: 60,
  dailyMinutes: 24 * 60,
  weeklyEnabled: false,
  weeklyMinutes: 7 * 24 * 60,
  jitterMaxSeconds: 0,
};

const logger = {
  info: vi.fn(),
  error: vi.fn(),
} as unknown as WatcherLogger;

describe('MaintenanceScheduler', () => {
  it('holds the database-backed scheduler lease while checking and running', async () => {
    const now = new Date('2026-10-12T06:00:00.000Z');
    const latestRun = vi.fn().mockResolvedValue(null);
    const run = vi.fn().mockResolvedValue({ findings: [], runId: 'run-1' });
    const onReport = vi.fn().mockResolvedValue(undefined);
    const withExclusiveLease = vi.fn(
      async <T>(_resource: string, task: () => Promise<T>) => task(),
    );
    const scheduler = new MaintenanceScheduler(
      { run } as never,
      { latestRun } as never,
      { withExclusiveLease: withExclusiveLease as never },
      settings,
      onReport,
      logger,
    );

    await scheduler.tick(now);

    expect(withExclusiveLease).toHaveBeenCalledWith(
      maintenanceSchedulerLease,
      expect.any(Function),
      20 * 60_000,
    );
    expect(run).toHaveBeenCalledWith('DAILY', 24 * 7, now);
    expect(onReport).toHaveBeenCalledWith('DAILY', [], 'run-1');
  });

  it('serializes competing instances and emits one daily report', async () => {
    const now = new Date('2026-10-12T06:00:00.000Z');
    const latestFinishedAt = new Map<string, Date>();
    let leaseTail: Promise<unknown> = Promise.resolve();
    const withExclusiveLease = <T>(
      _resource: string,
      task: () => Promise<T>,
    ): Promise<T> => {
      const result = leaseTail.then(task);
      leaseTail = result.catch(() => undefined);
      return result;
    };
    const latestRun = vi.fn(async (type: string) => {
      const finishedAt = latestFinishedAt.get(type);
      return finishedAt ? { finishedAt } : null;
    });
    const run = vi.fn(async (type: string) => {
      latestFinishedAt.set(type, now);
      return { findings: [], runId: `${type.toLowerCase()}-run` };
    });
    const onReport = vi.fn().mockResolvedValue(undefined);
    const createScheduler = () =>
      new MaintenanceScheduler(
        { run } as never,
        { latestRun } as never,
        { withExclusiveLease },
        settings,
        onReport,
        logger,
      );

    await Promise.all([
      createScheduler().tick(now),
      createScheduler().tick(now),
    ]);

    expect(latestRun).toHaveBeenCalledTimes(3);
    expect(run.mock.calls.filter(([type]) => type === 'DAILY')).toHaveLength(1);
    expect(onReport).toHaveBeenCalledTimes(1);
  });
});
