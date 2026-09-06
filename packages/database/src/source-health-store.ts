import type {
  SourceAttemptDecision,
  SourceHealthContext,
  WatcherKind as CoreWatcherKind,
} from '@watcher/core';
import type { DatabaseClient } from './client.js';
import { SourceHealthStatus } from './generated/prisma/enums.js';

type SourceHealthOptions = {
  baseBackoffMs: number;
  maximumBackoffMs: number;
};

const isRateLimited = (message: string): boolean =>
  /\b429\b|rate[_ -]?limit|too many requests|requests more sparingly/i.test(
    message,
  );

export const PROVIDER_BACKOFF_TARGET = '__PROVIDER__';

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
    _kind: CoreWatcherKind,
    runId: string,
    source: string,
    target: string,
    now: Date,
    context: SourceHealthContext = {},
  ): Promise<SourceAttemptDecision> {
    const watcherConfigId = await this.configId(runId);
    const providerSource = context.providerKey ?? source;
    const [health, providerHealth] = await Promise.all([
      this.db.sourceHealth.findUnique({
        where: {
          watcherConfigId_source_target: { watcherConfigId, source, target },
        },
      }),
      context.sharedRateLimitBackoff
        ? this.db.sourceHealth.findFirst({
            where: {
              status: SourceHealthStatus.RATE_LIMITED,
              backoffUntil: { gt: now },
              OR: [
                {
                  source: providerSource,
                  target: PROVIDER_BACKOFF_TARGET,
                },
                {
                  source,
                  target: { not: PROVIDER_BACKOFF_TARGET },
                },
              ],
            },
            orderBy: { backoffUntil: 'desc' },
          })
        : undefined,
    ]);
    if (providerHealth?.backoffUntil && providerHealth.backoffUntil > now) {
      return {
        allowed: false,
        retryAt: providerHealth.backoffUntil,
        status: providerHealth.status,
      };
    }
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
    _kind: CoreWatcherKind,
    runId: string,
    source: string,
    target: string,
    now: Date,
    context: SourceHealthContext = {},
  ): Promise<void> {
    const watcherConfigId = await this.configId(runId);
    const providerSource = context.providerKey ?? source;
    await this.db.$transaction(async (transaction) => {
      await transaction.sourceHealth.upsert({
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
      if (context.sharedRateLimitBackoff) {
        await transaction.sourceHealth.updateMany({
          where: {
            source: providerSource,
            target: PROVIDER_BACKOFF_TARGET,
            OR: [{ backoffUntil: null }, { backoffUntil: { lte: now } }],
          },
          data: {
            status: SourceHealthStatus.HEALTHY,
            consecutiveFailures: 0,
            lastAttemptAt: now,
            lastSuccessAt: now,
            backoffUntil: null,
            lastError: null,
          },
        });
      }
    });
  }

  public async failure(
    _kind: CoreWatcherKind,
    runId: string,
    source: string,
    target: string,
    message: string,
    now: Date,
    context: SourceHealthContext = {},
  ): Promise<void> {
    const watcherConfigId = await this.configId(runId);
    const providerSource = context.providerKey ?? source;
    await this.db.$transaction(async (transaction) => {
      const rateLimited = context.rateLimited ?? isRateLimited(message);
      const saveFailure = async (
        sourceKey: string,
        targetKey: string,
      ): Promise<void> => {
        const current = await transaction.sourceHealth.findUnique({
          where: {
            watcherConfigId_source_target: {
              watcherConfigId,
              source: sourceKey,
              target: targetKey,
            },
          },
        });
        const failures = (current?.consecutiveFailures ?? 0) + 1;
        const delay = Math.min(
          this.options.maximumBackoffMs,
          (rateLimited ? 15 * 60_000 : this.options.baseBackoffMs) *
            2 ** Math.max(0, failures - 1),
        );
        const computedBackoff = new Date(now.getTime() + delay);
        const backoffUntil =
          context.retryAt && context.retryAt > now
            ? context.retryAt
            : computedBackoff;
        const status = rateLimited
          ? SourceHealthStatus.RATE_LIMITED
          : failures >= 3
            ? SourceHealthStatus.UNAVAILABLE
            : SourceHealthStatus.DEGRADED;
        await transaction.sourceHealth.upsert({
          where: {
            watcherConfigId_source_target: {
              watcherConfigId,
              source: sourceKey,
              target: targetKey,
            },
          },
          create: {
            watcherConfigId,
            source: sourceKey,
            target: targetKey,
            status,
            consecutiveFailures: failures,
            lastAttemptAt: now,
            lastFailureAt: now,
            backoffUntil,
            lastError: message.slice(0, 2_000),
          },
          update: {
            status,
            consecutiveFailures: failures,
            lastAttemptAt: now,
            lastFailureAt: now,
            backoffUntil,
            lastError: message.slice(0, 2_000),
          },
        });
      };
      await saveFailure(source, target);
      if (rateLimited && context.sharedRateLimitBackoff) {
        await saveFailure(providerSource, PROVIDER_BACKOFF_TARGET);
      }
    });
  }
}
