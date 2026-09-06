import { watcherBotIdSchema, type WatcherBotId } from '@watcher/core';
import { z } from 'zod';
import type { DatabaseClient } from './client.js';
import type { BriefingWatcherHealth } from './generated/prisma/client.js';
import { BriefingWatcherHealthStatus } from './generated/prisma/enums.js';
import {
  fromDatabaseBriefingWatcherHealth,
  fromDatabaseWatcher,
  toDatabaseWatcher,
  type BriefingWatcherHealthStatusId,
} from './utils/briefing-mappers.js';

const healthyRunSchema = z
  .object({
    watcherBot: watcherBotIdSchema,
    degraded: z.boolean(),
    eventsEmitted: z.number().int().nonnegative(),
    failedEventPublications: z.number().int().nonnegative(),
    sourceFailures: z.number().int().nonnegative(),
    runAt: z.date().optional(),
  })
  .strict();

const failedRunSchema = z
  .object({
    watcherBot: watcherBotIdSchema,
    error: z.string().trim().min(1).max(5_000),
    runAt: z.date().optional(),
  })
  .strict();

export type BriefingWatcherHealthRecord = {
  watcherBot: WatcherBotId;
  status: BriefingWatcherHealthStatusId;
  lastRunAt: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastError?: string;
  eventsEmitted: number;
  failedEventPublications: number;
  sourceFailures: number;
};

const toRecord = (
  health: BriefingWatcherHealth,
): BriefingWatcherHealthRecord => ({
  watcherBot: fromDatabaseWatcher(health.watcherBot),
  status: fromDatabaseBriefingWatcherHealth(health.status),
  lastRunAt: health.lastRunAt.toISOString(),
  ...(health.lastSuccessAt
    ? { lastSuccessAt: health.lastSuccessAt.toISOString() }
    : {}),
  ...(health.lastFailureAt
    ? { lastFailureAt: health.lastFailureAt.toISOString() }
    : {}),
  ...(health.lastError ? { lastError: health.lastError } : {}),
  eventsEmitted: health.eventsEmitted,
  failedEventPublications: health.failedEventPublications,
  sourceFailures: health.sourceFailures,
});

export class BriefingWatcherHealthStore {
  public constructor(private readonly db: DatabaseClient) {}

  public async recordRun(
    rawInput: unknown,
  ): Promise<BriefingWatcherHealthRecord> {
    const input = healthyRunSchema.parse(rawInput);
    const runAt = input.runAt ?? new Date();
    const status = input.degraded
      ? BriefingWatcherHealthStatus.DEGRADED
      : BriefingWatcherHealthStatus.HEALTHY;
    const health = await this.db.briefingWatcherHealth.upsert({
      where: { watcherBot: toDatabaseWatcher(input.watcherBot) },
      create: {
        watcherBot: toDatabaseWatcher(input.watcherBot),
        status,
        lastRunAt: runAt,
        lastSuccessAt: runAt,
        eventsEmitted: input.eventsEmitted,
        failedEventPublications: input.failedEventPublications,
        sourceFailures: input.sourceFailures,
      },
      update: {
        status,
        lastRunAt: runAt,
        lastSuccessAt: runAt,
        lastError: null,
        eventsEmitted: input.eventsEmitted,
        failedEventPublications: input.failedEventPublications,
        sourceFailures: input.sourceFailures,
      },
    });
    return toRecord(health);
  }

  public async recordFailure(
    rawInput: unknown,
  ): Promise<BriefingWatcherHealthRecord> {
    const input = failedRunSchema.parse(rawInput);
    const runAt = input.runAt ?? new Date();
    const watcherBot = toDatabaseWatcher(input.watcherBot);
    const health = await this.db.briefingWatcherHealth.upsert({
      where: { watcherBot },
      create: {
        watcherBot,
        status: BriefingWatcherHealthStatus.UNAVAILABLE,
        lastRunAt: runAt,
        lastFailureAt: runAt,
        lastError: input.error,
      },
      update: {
        status: BriefingWatcherHealthStatus.UNAVAILABLE,
        lastRunAt: runAt,
        lastFailureAt: runAt,
        lastError: input.error,
      },
    });
    return toRecord(health);
  }

  public async list(
    watcherBots: readonly WatcherBotId[],
  ): Promise<BriefingWatcherHealthRecord[]> {
    if (watcherBots.length === 0) return [];
    const health = await this.db.briefingWatcherHealth.findMany({
      where: { watcherBot: { in: watcherBots.map(toDatabaseWatcher) } },
      orderBy: { watcherBot: 'asc' },
    });
    return health.map(toRecord);
  }
}
