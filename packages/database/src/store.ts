import {
  computeNextRun,
  contentHash,
  type AnalysisOutcome,
  type PipelineRepository,
  type WatcherKind as CoreWatcherKind,
  type WatchItem,
} from '@watcher/core';
import type { DatabaseClient } from './client.js';
import type { Prisma } from './generated/prisma/client.js';
import {
  AnalysisStatus,
  PublicationSourceType,
  RunStatus,
  RunTrigger,
  StockSourceType,
  WatcherKind,
} from './generated/prisma/enums.js';

const DEFAULT_SCHEDULE = '0 8 * * *';
const DEFAULT_TIMEZONE = 'Europe/Prague';
const OLLAMA_ADVISORY_LOCK_ID = 8_643_921_771;
const kindValue = (kind: CoreWatcherKind): WatcherKind =>
  kind === 'STOCKS' ? WatcherKind.STOCKS : WatcherKind.PUBLICATIONS;

export class WatcherStore implements PipelineRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public async ensureChat(
    kind: CoreWatcherKind,
    chatId: bigint,
    timezone = DEFAULT_TIMEZONE,
  ) {
    const existing = await this.getChat(kind, chatId);
    if (existing?.watcherConfig) return existing;
    return this.db.telegramChat.create({
      data: {
        kind: kindValue(kind),
        chatId,
        watcherConfig: {
          create: {
            schedule: DEFAULT_SCHEDULE,
            timezone,
            nextRunAt: computeNextRun(DEFAULT_SCHEDULE, timezone),
          },
        },
      },
      include: { watcherConfig: true },
    });
  }

  public getChat(kind: CoreWatcherKind, chatId: bigint) {
    return this.db.telegramChat.findUnique({
      where: { kind_chatId: { kind: kindValue(kind), chatId } },
      include: { watcherConfig: true },
    });
  }

  public withOllamaLease<T>(task: () => Promise<T>): Promise<T> {
    return this.db.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(${OLLAMA_ADVISORY_LOCK_ID})`;
        return task();
      },
      { maxWait: 600_000, timeout: 600_000 },
    );
  }

  public async updateSchedule(
    configId: string,
    schedule: string,
    timezone: string,
  ) {
    return this.db.watcherConfig.update({
      where: { id: configId },
      data: {
        schedule,
        timezone,
        nextRunAt: computeNextRun(schedule, timezone),
      },
    });
  }

  public setEnabled(configId: string, enabled: boolean) {
    return this.db.watcherConfig.update({
      where: { id: configId },
      data: { enabled },
    });
  }

  public listDue(kind: CoreWatcherKind, now: Date) {
    return this.db.watcherConfig.findMany({
      where: {
        enabled: true,
        nextRunAt: { lte: now },
        chatConfig: { kind: kindValue(kind) },
      },
      select: { id: true, chatConfig: { select: { chatId: true } } },
    });
  }

  public async claimRun(configId: string, trigger: 'MANUAL' | 'SCHEDULED') {
    const staleBefore = new Date(Date.now() - 2 * 60 * 60 * 1000);
    return this.db.$transaction(async (transaction) => {
      const claimed = await transaction.watcherConfig.updateMany({
        where: {
          id: configId,
          OR: [{ runInProgress: false }, { runStartedAt: { lt: staleBefore } }],
        },
        data: { runInProgress: true, runStartedAt: new Date() },
      });
      if (claimed.count === 0) return undefined;
      return transaction.watcherRun.create({
        data: {
          watcherConfigId: configId,
          trigger:
            trigger === 'MANUAL' ? RunTrigger.MANUAL : RunTrigger.SCHEDULED,
        },
      });
    });
  }

  public async finishRun(
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
  ): Promise<void> {
    const config = await this.db.watcherConfig.findUniqueOrThrow({
      where: { id: configId },
    });
    const status = RunStatus[result.status];
    await this.db.$transaction([
      this.db.watcherRun.update({
        where: { id: runId },
        data: {
          status,
          finishedAt: new Date(),
          fetchedCount: result.fetchedCount ?? 0,
          newItemCount: result.newItemCount ?? 0,
          analyzedCount: result.analyzedCount ?? 0,
          failedAnalysisCount: result.failedAnalysisCount ?? 0,
          ...(result.error === undefined ? {} : { error: result.error }),
        },
      }),
      this.db.watcherConfig.update({
        where: { id: configId },
        data: {
          runInProgress: false,
          runStartedAt: null,
          lastRunAt: new Date(),
          lastRunStatus: status,
          nextRunAt: computeNextRun(config.schedule, config.timezone),
        },
      }),
    ]);
  }

  public async recordSourceFailures(
    runId: string,
    failures: Array<{ source: string; target: string; message: string }>,
  ): Promise<void> {
    if (failures.length > 0) {
      await this.db.sourceFailure.createMany({
        data: failures.map((failure) => ({ runId, ...failure })),
      });
    }
  }

  public async reserveNewItems(kind: CoreWatcherKind, items: WatchItem[]) {
    if (items.length === 0) return [];
    const created = await this.db.processedItem.createManyAndReturn({
      skipDuplicates: true,
      data: items.map((item) => ({
        watcherKind: kindValue(kind),
        source: item.source,
        externalId: item.externalId,
        title: item.title,
        url: item.url,
        ...(item.publishedAt === undefined
          ? {}
          : { publishedAt: item.publishedAt }),
        contentHash: contentHash(item.content),
        metadata: item.metadata as Prisma.InputJsonValue,
      })),
    });
    const byIdentity = new Map(
      items.map((item) => [`${item.source}\u0000${item.externalId}`, item]),
    );
    return created.flatMap((entry) => {
      const item = byIdentity.get(`${entry.source}\u0000${entry.externalId}`);
      return item ? [{ recordId: entry.id, item }] : [];
    });
  }

  public async saveAnalysis(
    runId: string,
    itemId: string,
    outcome: AnalysisOutcome,
  ): Promise<void> {
    await this.db.analysis.create({
      data: {
        runId,
        processedItemId: itemId,
        status:
          outcome.status === 'SUCCESS'
            ? AnalysisStatus.SUCCESS
            : AnalysisStatus.FAILED,
        ...(outcome.status === 'SUCCESS'
          ? { result: outcome.result as Prisma.InputJsonValue }
          : { error: outcome.error }),
      },
    });
  }

  public async addStock(chatConfigId: string, symbol: string) {
    return this.db.stock.create({
      data: {
        chatConfigId,
        symbol,
        sources: {
          create: Object.values(StockSourceType).map((source) => ({
            source,
            enabled: source === StockSourceType.SEC,
          })),
        },
      },
      include: { sources: true },
    });
  }

  public listStocks(chatConfigId: string) {
    return this.db.stock.findMany({
      where: { chatConfigId },
      include: { sources: true },
      orderBy: { symbol: 'asc' },
    });
  }

  public removeStock(chatConfigId: string, symbol: string) {
    return this.db.stock.deleteMany({ where: { chatConfigId, symbol } });
  }

  public async toggleStockSource(stockId: string, source: StockSourceType) {
    const current = await this.db.stockSourceConfig.findUniqueOrThrow({
      where: { stockId_source: { stockId, source } },
    });
    return this.db.stockSourceConfig.update({
      where: { id: current.id },
      data: { enabled: !current.enabled },
    });
  }

  public async setStockSourceConfig(
    stockId: string,
    source: StockSourceType,
    config: object,
  ) {
    return this.db.stockSourceConfig.update({
      where: { stockId_source: { stockId, source } },
      data: { config, enabled: true },
    });
  }

  public async addQuery(chatConfigId: string, query: string) {
    return this.db.publicationQuery.create({
      data: {
        chatConfigId,
        query,
        normalizedQuery: query.trim().toLowerCase(),
        sources: {
          create: Object.values(PublicationSourceType).map((source) => ({
            source,
            enabled: source === PublicationSourceType.PUBMED,
          })),
        },
      },
      include: { sources: true },
    });
  }

  public listQueries(chatConfigId: string) {
    return this.db.publicationQuery.findMany({
      where: { chatConfigId },
      include: { sources: true },
      orderBy: { query: 'asc' },
    });
  }

  public removeQuery(chatConfigId: string, query: string) {
    return this.db.publicationQuery.deleteMany({
      where: { chatConfigId, normalizedQuery: query.trim().toLowerCase() },
    });
  }

  public async togglePublicationSource(
    queryId: string,
    source: PublicationSourceType,
  ) {
    const current = await this.db.publicationSourceConfig.findUniqueOrThrow({
      where: { queryId_source: { queryId, source } },
    });
    return this.db.publicationSourceConfig.update({
      where: { id: current.id },
      data: { enabled: !current.enabled },
    });
  }
}

export { PublicationSourceType, RunStatus, StockSourceType, WatcherKind };
