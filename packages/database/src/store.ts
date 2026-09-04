import {
  computeNextRun,
  contentHash,
  type AnalysisOutcome,
  type PipelineRepository,
  type PreparedItem,
  type WatcherKind as CoreWatcherKind,
  type WatchItem,
  publicationAnalysisSchema,
  stockAnalysisSchema,
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
const DEFAULT_STOCK_SOURCE_TYPES = [
  StockSourceType.SEC,
  StockSourceType.PRICE,
  StockSourceType.FINVIZ,
  StockSourceType.ZACKS,
  StockSourceType.EARNINGS_WHISPERS,
];
const kindValue = (kind: CoreWatcherKind): WatcherKind =>
  kind === 'STOCKS' ? WatcherKind.STOCKS : WatcherKind.PUBLICATIONS;
const identityKey = (item: { source: string; externalId: string }): string =>
  `${item.source}\u0000${item.externalId}`;

const cachedOutcome = (
  kind: CoreWatcherKind,
  result: Prisma.JsonValue,
): AnalysisOutcome => ({
  status: 'SUCCESS',
  result:
    kind === 'STOCKS'
      ? stockAnalysisSchema.parse(result)
      : publicationAnalysisSchema.parse(result),
});

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

  public async prepareItemsForRun(
    kind: CoreWatcherKind,
    runId: string,
    items: WatchItem[],
    maxAnalyses: number,
  ): Promise<PreparedItem[]> {
    if (items.length === 0) return [];
    const run = await this.db.watcherRun.findUniqueOrThrow({
      where: { id: runId },
      select: { watcherConfigId: true },
    });
    const identityFilters = items.map((item) => ({
      source: item.source,
      externalId: item.externalId,
    }));
    const existing =
      identityFilters.length === 0
        ? []
        : await this.db.processedItem.findMany({
            where: {
              watcherKind: kindValue(kind),
              OR: identityFilters,
            },
            include: {
              analyses: {
                where: { status: AnalysisStatus.SUCCESS },
                orderBy: { createdAt: 'desc' },
                include: {
                  run: { select: { watcherConfigId: true } },
                },
              },
            },
          });
    const existingByIdentity = new Map(
      existing.map((item) => [identityKey(item), item]),
    );
    const selectedForAnalysis = new Set<string>();
    const selectedNewItems: WatchItem[] = [];
    let remainingAnalysisSlots = maxAnalyses === 0 ? Infinity : maxAnalyses;

    for (const item of items) {
      const key = identityKey(item);
      const processedItem = existingByIdentity.get(key);
      const deliveredToThisWatcher = processedItem?.analyses.some(
        (analysis) => analysis.run.watcherConfigId === run.watcherConfigId,
      );
      if (deliveredToThisWatcher) continue;
      const latestSuccess = processedItem?.analyses[0];
      if (latestSuccess?.result) continue;
      if (remainingAnalysisSlots <= 0) continue;
      selectedForAnalysis.add(key);
      if (!processedItem) selectedNewItems.push(item);
      remainingAnalysisSlots -= 1;
    }

    const created = await this.db.processedItem.createManyAndReturn({
      skipDuplicates: true,
      data: selectedNewItems.map((item) => ({
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
    const createdByIdentity = new Map(
      created.map((item) => [identityKey(item), item]),
    );
    return items.flatMap((item) => {
      const key = identityKey(item);
      const processedItem = existingByIdentity.get(key);
      const deliveredToThisWatcher = processedItem?.analyses.some(
        (analysis) => analysis.run.watcherConfigId === run.watcherConfigId,
      );
      if (deliveredToThisWatcher) return [];
      const latestSuccess = processedItem?.analyses[0];
      if (processedItem && latestSuccess?.result)
        return [
          {
            recordId: processedItem.id,
            item,
            outcome: cachedOutcome(kind, latestSuccess.result),
          },
        ];
      if (!selectedForAnalysis.has(key)) return [];
      const createdItem = createdByIdentity.get(key);
      const recordId = processedItem?.id ?? createdItem?.id;
      return recordId ? [{ recordId, item }] : [];
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

  public async addStock(
    chatConfigId: string,
    symbol: string,
    company?: { companyName: string; cik: string },
  ) {
    return this.db.stock.create({
      data: {
        chatConfigId,
        symbol,
        ...(company === undefined
          ? {}
          : { companyName: company.companyName, cik: company.cik }),
        sources: {
          create: DEFAULT_STOCK_SOURCE_TYPES.map((source) => ({
            source,
            enabled: true,
          })),
        },
      },
      include: { sources: true },
    });
  }

  public async listStocks(chatConfigId: string) {
    const stocks = await this.db.stock.findMany({
      where: { chatConfigId },
      include: { sources: true },
      orderBy: { symbol: 'asc' },
    });
    const missingSources = stocks.flatMap((stock) => {
      const existing = new Set(stock.sources.map(({ source }) => source));
      return DEFAULT_STOCK_SOURCE_TYPES.flatMap((source) =>
        existing.has(source)
          ? []
          : [{ stockId: stock.id, source, enabled: true }],
      );
    });
    if (missingSources.length === 0) return stocks;

    await this.db.stockSourceConfig.createMany({
      data: missingSources,
      skipDuplicates: true,
    });
    return this.db.stock.findMany({
      where: { chatConfigId },
      include: { sources: true },
      orderBy: { symbol: 'asc' },
    });
  }

  public updateStockCompany(
    stockId: string,
    company: { companyName: string; cik: string },
  ) {
    return this.db.stock.update({
      where: { id: stockId },
      data: { companyName: company.companyName, cik: company.cik },
      include: { sources: true },
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
            enabled: true,
          })),
        },
      },
      include: { sources: true },
    });
  }

  public async addQueries(chatConfigId: string, queries: string[]) {
    const uniqueQueries = new Map<string, string>();
    for (const query of queries) {
      const trimmed = query.trim();
      const normalized = trimmed.toLowerCase();
      if (!uniqueQueries.has(normalized))
        uniqueQueries.set(normalized, trimmed);
    }
    const normalizedQueries = [...uniqueQueries.keys()];
    if (!normalizedQueries.length)
      return { addedCount: 0, skippedCount: 0, totalCount: 0 };

    return this.db.$transaction(async (tx) => {
      const created = await tx.publicationQuery.createMany({
        data: [...uniqueQueries].map(([normalizedQuery, query]) => ({
          chatConfigId,
          query,
          normalizedQuery,
        })),
        skipDuplicates: true,
      });
      const savedQueries = await tx.publicationQuery.findMany({
        where: { chatConfigId, normalizedQuery: { in: normalizedQueries } },
        select: { id: true },
      });
      await tx.publicationSourceConfig.createMany({
        data: savedQueries.flatMap((query) =>
          Object.values(PublicationSourceType).map((source) => ({
            queryId: query.id,
            source,
            enabled: true,
          })),
        ),
        skipDuplicates: true,
      });

      return {
        addedCount: created.count,
        skippedCount: normalizedQueries.length - created.count,
        totalCount: normalizedQueries.length,
      };
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
