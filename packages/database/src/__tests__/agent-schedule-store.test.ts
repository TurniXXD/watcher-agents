import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient } from '../client.js';
import { AgentScheduleStore } from '../agent-schedule-store.js';

describe('AgentScheduleStore', () => {
  it('queues an enabled watcher for its existing scheduler', async () => {
    const nextRunAt = new Date('2026-09-09T10:00:00Z');
    const findUnique = vi.fn(async () => ({
      watcherConfig: {
        id: 'config-1',
        enabled: true,
        runInProgress: false,
      },
    }));
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const database = {
      telegramChat: { findUnique },
      watcherConfig: { updateMany },
    } as unknown as DatabaseClient;

    await expect(
      new AgentScheduleStore(database).requestWatcherRun(
        42n,
        'news',
        nextRunAt,
      ),
    ).resolves.toEqual({ status: 'QUEUED' });
    expect(findUnique).toHaveBeenCalledWith({
      where: { kind_chatId: { kind: 'NEWS', chatId: 42n } },
      select: {
        watcherConfig: {
          select: { id: true, enabled: true, runInProgress: true },
        },
      },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'config-1', enabled: true, runInProgress: false },
      data: { nextRunAt },
    });
  });

  it.each([
    [null, 'NOT_CONFIGURED'],
    [
      {
        watcherConfig: { id: 'config-1', enabled: false, runInProgress: false },
      },
      'DISABLED',
    ],
    [
      { watcherConfig: { id: 'config-1', enabled: true, runInProgress: true } },
      'BUSY',
    ],
  ] as const)('does not queue an unavailable watcher', async (chat, status) => {
    const updateMany = vi.fn();
    const database = {
      telegramChat: { findUnique: vi.fn(async () => chat) },
      watcherConfig: { updateMany },
    } as unknown as DatabaseClient;

    await expect(
      new AgentScheduleStore(database).requestWatcherRun(42n, 'stocks'),
    ).resolves.toEqual({ status });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('combines per-chat watcher schedules with global agent state', async () => {
    const database = {
      briefingSettings: {
        findUnique: vi.fn(async () => ({
          onboardingComplete: true,
          briefingTime: '07:00',
          timezone: 'Europe/Prague',
          nextBriefingAt: new Date('2026-09-09T05:00:00Z'),
        })),
      },
      telegramChat: {
        findMany: vi.fn(async () => [
          {
            kind: 'STOCKS',
            watcherConfig: {
              enabled: true,
              schedule: '30 6 * * *',
              timezone: 'Europe/Prague',
              nextRunAt: new Date('2026-09-09T04:30:00Z'),
              lastRunAt: new Date('2026-09-08T04:30:00Z'),
              lastRunStatus: 'SUCCESS',
              runInProgress: false,
            },
          },
          {
            kind: 'PUBLICATIONS',
            watcherConfig: {
              enabled: true,
              schedule: '0 4 * * *',
              timezone: 'Europe/Prague',
              nextRunAt: new Date('2026-09-09T02:00:00Z'),
              lastRunAt: null,
              lastRunStatus: null,
              runInProgress: true,
            },
          },
        ]),
      },
      muMonitorState: {
        findUnique: vi.fn(async () => ({
          nextRunAt: new Date('2026-09-09T03:00:00Z'),
          lastRunAt: new Date('2026-09-08T03:00:00Z'),
          runInProgress: false,
        })),
      },
      muMonitorRun: {
        findFirst: vi.fn(async () => ({ status: 'SUCCESS' })),
      },
      briefingWatcherHealth: {
        findMany: vi.fn(async () => [
          {
            watcherBot: 'STOCKS',
            status: 'HEALTHY',
            lastRunAt: new Date('2026-09-08T04:31:00Z'),
          },
          {
            watcherBot: 'MEDICAL',
            status: 'DEGRADED',
            lastRunAt: new Date('2026-09-08T02:01:00Z'),
          },
        ]),
      },
      brnoEventSourceRun: {
        findMany: vi.fn(async () => [
          {
            sourceId: 'goout',
            finishedAt: new Date('2026-09-08T01:00:00Z'),
            success: true,
          },
        ]),
      },
    } as unknown as DatabaseClient;

    const overview = await new AgentScheduleStore(database).get(42n);

    expect(overview.briefing?.nextRunAt).toEqual(
      new Date('2026-09-09T05:00:00Z'),
    );
    expect(overview.watchers).toMatchObject([
      { id: 'stocks', configured: true, health: 'HEALTHY' },
      {
        id: 'medical',
        configured: true,
        runInProgress: true,
        health: 'DEGRADED',
      },
      { id: 'news', configured: false },
    ]);
    expect(overview.muClubs).toMatchObject({ lastRunStatus: 'SUCCESS' });
    expect(overview.brnoEventSources).toMatchObject([
      { sourceId: 'goout', success: true },
    ]);
  });
});
