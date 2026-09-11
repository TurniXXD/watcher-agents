import { describe, expect, it, vi } from 'vitest';
import { waitForFreshWatcherRuns } from '../briefing-freshness.js';

const health = (watcherBot: 'stocks' | 'medical', lastRunAt: string) => ({
  watcherBot,
  status: 'HEALTHY' as const,
  lastRunAt,
  eventsEmitted: 0,
  failedEventPublications: 0,
  sourceFailures: 0,
});

describe('waitForFreshWatcherRuns', () => {
  it('waits until every subscribed watcher has a recent run', async () => {
    let clock = 0;
    const list = vi
      .fn()
      .mockResolvedValueOnce([
        health('stocks', '2026-09-06T01:00:00.000Z'),
        health('medical', '2026-09-06T03:30:00.000Z'),
      ])
      .mockResolvedValueOnce([
        health('stocks', '2026-09-06T04:45:00.000Z'),
        health('medical', '2026-09-06T04:30:00.000Z'),
      ]);

    const result = await waitForFreshWatcherRuns({
      watcherHealth: { list },
      subscriptions: ['stocks', 'medical'],
      referenceTime: new Date('2026-09-06T05:00:00.000Z'),
      maximumAgeMs: 60 * 60_000,
      timeoutMs: 10_000,
      pollIntervalMs: 1_000,
      clock: () => clock,
      sleep: async (milliseconds) => {
        clock += milliseconds;
      },
    });

    expect(result).toMatchObject({ timedOut: false, staleWatchers: [] });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('triggers every stale subscribed watcher once before polling', async () => {
    let clock = 0;
    const trigger = vi.fn(async () => ({ status: 'QUEUED' }));
    const list = vi
      .fn()
      .mockResolvedValueOnce([
        health('stocks', '2026-09-06T01:00:00.000Z'),
        health('medical', '2026-09-06T03:30:00.000Z'),
      ])
      .mockResolvedValueOnce([
        health('stocks', '2026-09-06T04:45:00.000Z'),
        health('medical', '2026-09-06T04:30:00.000Z'),
      ]);

    const result = await waitForFreshWatcherRuns({
      watcherHealth: { list },
      subscriptions: ['stocks', 'medical'],
      referenceTime: new Date('2026-09-06T05:00:00.000Z'),
      maximumAgeMs: 60 * 60_000,
      timeoutMs: 10_000,
      pollIntervalMs: 1_000,
      trigger,
      clock: () => clock,
      sleep: async (milliseconds) => {
        clock += milliseconds;
      },
    });

    expect(result).toMatchObject({ timedOut: false, staleWatchers: [] });
    expect(trigger).toHaveBeenCalledTimes(2);
    expect(trigger).toHaveBeenCalledWith('stocks');
    expect(trigger).toHaveBeenCalledWith('medical');
  });

  it('keeps waiting when one stale watcher trigger fails', async () => {
    let clock = 0;
    const list = vi
      .fn()
      .mockResolvedValueOnce([health('stocks', '2026-09-06T01:00:00.000Z')])
      .mockResolvedValueOnce([health('stocks', '2026-09-06T04:45:00.000Z')]);

    const result = await waitForFreshWatcherRuns({
      watcherHealth: { list },
      subscriptions: ['stocks'],
      referenceTime: new Date('2026-09-06T05:00:00.000Z'),
      maximumAgeMs: 60 * 60_000,
      timeoutMs: 10_000,
      pollIntervalMs: 1_000,
      trigger: vi.fn(async () => {
        throw new Error('producer unavailable');
      }),
      clock: () => clock,
      sleep: async (milliseconds) => {
        clock += milliseconds;
      },
    });

    expect(result).toMatchObject({ timedOut: false, staleWatchers: [] });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('returns stale watcher IDs after the bounded timeout', async () => {
    let clock = 0;
    const result = await waitForFreshWatcherRuns({
      watcherHealth: {
        list: vi.fn(async () => [health('stocks', '2026-09-06T01:00:00.000Z')]),
      },
      subscriptions: ['stocks', 'medical'],
      referenceTime: new Date('2026-09-06T05:00:00.000Z'),
      maximumAgeMs: 60 * 60_000,
      timeoutMs: 2_000,
      pollIntervalMs: 1_000,
      clock: () => clock,
      sleep: async (milliseconds) => {
        clock += milliseconds;
      },
    });

    expect(result).toMatchObject({
      timedOut: true,
      staleWatchers: ['stocks', 'medical'],
      waitedMs: 2_000,
    });
  });
});
