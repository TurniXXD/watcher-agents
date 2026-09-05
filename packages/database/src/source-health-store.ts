import type { SourceAttemptDecision, WatcherKind } from '@watcher/core';
import type { DatabaseClient } from './client.js';
import { SourceHealthStatus } from './generated/prisma/enums.js';

type SourceHealthOptions = {
  baseBackoffMs: number;
  maximumBackoffMs: number;
};

const isRateLimited = (message: string): boolean =>
  /\b429\b|rate[ -]?limit|too many requests/i.test(message);

export class SourceHealthStore {
  public constructor(
    private readonly db: DatabaseClient,
    private readonly options: SourceHealthOptions,
  ) {}

  private async configId(runId: string): Promise<string> {
    const run = await this.db.watcherRun.findUniqueOrThrow({
      where: { id: runId },
      select: { watcherConfigId: true },
    });
    return run.watcherConfigId;
  }

  public async attemptDecision(
    _kind: WatcherKind,
    runId: string,
    source: string,
    target: string,
    now: Date,
  ): Promise<SourceAttemptDecision> {
    const watcherConfigId = await this.configId(runId);
    const health = await this.db.sourceHealth.findUnique({
      where: {
        watcherConfigId_source_target: { watcherConfigId, source, target },
      },
    });
    if (!health?.backoffUntil || health.backoffUntil <= now) {
      return { allowed: true, status: health?.status ?? 'HEALTHY' };
    }
    return {
      allowed: false,
      retryAt: health.backoffUntil,
      status: health.status,
    };
  }

  public async success(
    _kind: WatcherKind,
    runId: string,
    source: string,
    target: string,
    now: Date,
  ): Promise<void> {
    const watcherConfigId = await this.configId(runId);
    await this.db.sourceHealth.upsert({
      where: {
        watcherConfigId_source_target: { watcherConfigId, source, target },
      },
      create: {
        watcherConfigId,
        source,
        target,
        status: SourceHealthStatus.HEALTHY,
        lastAttemptAt: now,
        lastSuccessAt: now,
      },
      update: {
        status: SourceHealthStatus.HEALTHY,
        consecutiveFailures: 0,
        lastAttemptAt: now,
        lastSuccessAt: now,
        backoffUntil: null,
        lastError: null,
      },
    });
  }

  public async failure(
    _kind: WatcherKind,
    runId: string,
    source: string,
    target: string,
    message: string,
    now: Date,
  ): Promise<void> {
    const watcherConfigId = await this.configId(runId);
    await this.db.$transaction(async (transaction) => {
      const current = await transaction.sourceHealth.findUnique({
        where: {
          watcherConfigId_source_target: { watcherConfigId, source, target },
        },
      });
      const failures = (current?.consecutiveFailures ?? 0) + 1;
      const rateLimited = isRateLimited(message);
      const delay = Math.min(
        this.options.maximumBackoffMs,
        (rateLimited ? 15 * 60_000 : this.options.baseBackoffMs) *
          2 ** Math.max(0, failures - 1),
      );
      const status = rateLimited
        ? SourceHealthStatus.RATE_LIMITED
        : failures >= 3
          ? SourceHealthStatus.UNAVAILABLE
          : SourceHealthStatus.DEGRADED;
      await transaction.sourceHealth.upsert({
        where: {
          watcherConfigId_source_target: { watcherConfigId, source, target },
        },
        create: {
          watcherConfigId,
          source,
          target,
          status,
          consecutiveFailures: failures,
          lastAttemptAt: now,
          lastFailureAt: now,
          backoffUntil: new Date(now.getTime() + delay),
          lastError: message.slice(0, 2_000),
        },
        update: {
          status,
          consecutiveFailures: failures,
          lastAttemptAt: now,
          lastFailureAt: now,
          backoffUntil: new Date(now.getTime() + delay),
          lastError: message.slice(0, 2_000),
        },
      });
    });
  }
}
