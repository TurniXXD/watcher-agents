import type { DatabaseClient } from './client.js';
import { PublicationSourceType } from './generated/prisma/enums.js';
import { type StockSourceType } from './generated/prisma/enums.js';
import { defaultStockSourceTypes } from './stock-source-defaults.js';
import { prismaJson } from './utils/json.js';
import {
  effectiveSourceEnabled,
  publicationSourceSettingsForChat,
  sourceSettingsRecord,
  stockSourceSettingsForChat,
} from './utils/source-settings.js';

export class ConfigurationStore {
  public constructor(private readonly db: DatabaseClient) {}

  public async listStocks(chatConfigId: string) {
    let stocks = await this.db.stock.findMany({
      where: { chatConfigId },
      include: {
        sources: true,
        discoverySignals: {
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { source: true, trigger: true, reason: true },
        },
      },
      orderBy: { symbol: 'asc' },
    });
    const globalSettings = await this.listStockSourceSettings(chatConfigId);
    const enabledBySource = new Map(
      globalSettings.map(({ source, enabled }) => [source, enabled]),
    );
    const missingSources = stocks.flatMap((stock) => {
      const existing = new Set(stock.sources.map(({ source }) => source));
      return defaultStockSourceTypes.flatMap((source) =>
        existing.has(source)
          ? []
          : [
              {
                stockId: stock.id,
                source,
                enabled: enabledBySource.get(source) ?? true,
              },
            ],
      );
    });
    if (missingSources.length > 0) {
      await this.db.stockSourceConfig.createMany({
        data: missingSources,
        skipDuplicates: true,
      });
      stocks = await this.db.stock.findMany({
        where: { chatConfigId },
        include: {
          sources: true,
          discoverySignals: {
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { source: true, trigger: true, reason: true },
          },
        },
        orderBy: { symbol: 'asc' },
      });
    }
    const watchReasonPairs = stocks.flatMap((stock) =>
      stock.watchReason
        ? [{ ticker: stock.symbol, title: stock.watchReason }]
        : [],
    );
    const watchEvents = watchReasonPairs.length
      ? await this.db.canonicalEvent.findMany({
          where: { OR: watchReasonPairs },
          orderBy: { firstDetectedAt: 'desc' },
          select: {
            ticker: true,
            title: true,
            primaryEvidence: {
              select: { source: true, sourceUrl: true, url: true },
            },
          },
        })
      : [];
    const watchSourceByReason = new Map<
      string,
      { source: string; url: string }
    >();
    for (const event of watchEvents) {
      const key = `${event.ticker}\u0000${event.title}`;
      if (!watchSourceByReason.has(key)) {
        watchSourceByReason.set(key, {
          source: event.primaryEvidence.source,
          url: event.primaryEvidence.sourceUrl ?? event.primaryEvidence.url,
        });
      }
    }
    return stocks.map((stock) => ({
      ...stock,
      watchReasonSource: stock.watchReason
        ? (watchSourceByReason.get(
            `${stock.symbol}\u0000${stock.watchReason}`,
          ) ?? null)
        : null,
    }));
  }

  public updateStockCompany(
    stockId: string,
    company: {
      companyName: string;
      cik: string;
      exchange?: string | null;
      industry?: string | null;
      investorRelationsUrl?: string | null;
    },
  ) {
    return this.db.stock.update({
      where: { id: stockId },
      data: {
        companyName: company.companyName,
        cik: company.cik,
        ...(company.exchange === undefined
          ? {}
          : { exchange: company.exchange }),
        ...(company.industry === undefined
          ? {}
          : { industry: company.industry }),
        ...(company.investorRelationsUrl === undefined
          ? {}
          : { investorRelationsUrl: company.investorRelationsUrl }),
      },
      include: { sources: true },
    });
  }

  public removeStock(chatConfigId: string, symbol: string) {
    return this.db.stock.deleteMany({ where: { chatConfigId, symbol } });
  }

  public listStockSourceSettings(chatConfigId: string) {
    return stockSourceSettingsForChat(this.db, chatConfigId);
  }

  public async toggleStockSourceForAll(
    chatConfigId: string,
    source: StockSourceType,
  ) {
    return this.db.$transaction(async (transaction) => {
      const watcher = await transaction.watcherConfig.findUniqueOrThrow({
        where: { chatConfigId },
        select: { id: true, sourceSettings: true },
      });
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${watcher.id}), hashtext(${source}))`;
      const existing = await transaction.stockSourceConfig.findMany({
        where: { source, stock: { chatConfigId } },
        select: { enabled: true },
      });
      const settings = sourceSettingsRecord(watcher.sourceSettings);
      const enabled = !effectiveSourceEnabled(
        settings,
        source,
        existing.map((entry) => entry.enabled),
      );
      const stocks = await transaction.stock.findMany({
        where: { chatConfigId },
        select: { id: true },
      });
      if (stocks.length > 0) {
        await transaction.stockSourceConfig.createMany({
          data: stocks.map((stock) => ({ stockId: stock.id, source, enabled })),
          skipDuplicates: true,
        });
        await transaction.stockSourceConfig.updateMany({
          where: { source, stock: { chatConfigId } },
          data: { enabled },
        });
      }
      await transaction.watcherConfig.update({
        where: { id: watcher.id },
        data: {
          sourceSettings: prismaJson({ ...settings, [source]: enabled }),
        },
      });
      return { source, enabled, affectedCount: stocks.length };
    });
  }

  public async addQuery(chatConfigId: string, query: string) {
    const settings = await this.listPublicationSourceSettings(chatConfigId);
    const enabledBySource = new Map(
      settings.map(({ source, enabled }) => [source, enabled]),
    );
    return this.db.publicationQuery.create({
      data: {
        chatConfigId,
        query,
        normalizedQuery: query.trim().toLowerCase(),
        sources: {
          create: Object.values(PublicationSourceType).map((source) => ({
            source,
            enabled: enabledBySource.get(source) ?? true,
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
    if (!normalizedQueries.length) {
      return { addedCount: 0, skippedCount: 0, totalCount: 0 };
    }
    const settings = await this.listPublicationSourceSettings(chatConfigId);
    const enabledBySource = new Map(
      settings.map(({ source, enabled }) => [source, enabled]),
    );
    return this.db.$transaction(async (transaction) => {
      const created = await transaction.publicationQuery.createMany({
        data: [...uniqueQueries].map(([normalizedQuery, query]) => ({
          chatConfigId,
          query,
          normalizedQuery,
        })),
        skipDuplicates: true,
      });
      const savedQueries = await transaction.publicationQuery.findMany({
        where: { chatConfigId, normalizedQuery: { in: normalizedQueries } },
        select: { id: true },
      });
      await transaction.publicationSourceConfig.createMany({
        data: savedQueries.flatMap(({ id }) =>
          Object.values(PublicationSourceType).map((source) => ({
            queryId: id,
            source,
            enabled: enabledBySource.get(source) ?? true,
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

  public async listQueries(chatConfigId: string) {
    let queries = await this.db.publicationQuery.findMany({
      where: { chatConfigId },
      include: { sources: true },
      orderBy: { query: 'asc' },
    });
    const settings = await this.listPublicationSourceSettings(chatConfigId);
    const enabledBySource = new Map(
      settings.map(({ source, enabled }) => [source, enabled]),
    );
    const missingSources = queries.flatMap((query) => {
      const existing = new Set(query.sources.map(({ source }) => source));
      return Object.values(PublicationSourceType).flatMap((source) =>
        existing.has(source)
          ? []
          : [
              {
                queryId: query.id,
                source,
                enabled: enabledBySource.get(source) ?? true,
              },
            ],
      );
    });
    if (missingSources.length > 0) {
      await this.db.publicationSourceConfig.createMany({
        data: missingSources,
        skipDuplicates: true,
      });
      queries = await this.db.publicationQuery.findMany({
        where: { chatConfigId },
        include: { sources: true },
        orderBy: { query: 'asc' },
      });
    }
    return queries;
  }

  public removeQuery(chatConfigId: string, query: string) {
    return this.db.publicationQuery.deleteMany({
      where: { chatConfigId, normalizedQuery: query.trim().toLowerCase() },
    });
  }

  public listPublicationSourceSettings(chatConfigId: string) {
    return publicationSourceSettingsForChat(this.db, chatConfigId);
  }

  public async togglePublicationSourceForAll(
    chatConfigId: string,
    source: PublicationSourceType,
  ) {
    return this.db.$transaction(async (transaction) => {
      const watcher = await transaction.watcherConfig.findUniqueOrThrow({
        where: { chatConfigId },
        select: { id: true, sourceSettings: true },
      });
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${watcher.id}), hashtext(${source}))`;
      const existing = await transaction.publicationSourceConfig.findMany({
        where: { source, query: { chatConfigId } },
        select: { enabled: true },
      });
      const settings = sourceSettingsRecord(watcher.sourceSettings);
      const enabled = !effectiveSourceEnabled(
        settings,
        source,
        existing.map((entry) => entry.enabled),
      );
      const queries = await transaction.publicationQuery.findMany({
        where: { chatConfigId },
        select: { id: true },
      });
      if (queries.length > 0) {
        await transaction.publicationSourceConfig.createMany({
          data: queries.map((query) => ({
            queryId: query.id,
            source,
            enabled,
          })),
          skipDuplicates: true,
        });
        await transaction.publicationSourceConfig.updateMany({
          where: { source, query: { chatConfigId } },
          data: { enabled },
        });
      }
      await transaction.watcherConfig.update({
        where: { id: watcher.id },
        data: {
          sourceSettings: prismaJson({ ...settings, [source]: enabled }),
        },
      });
      return { source, enabled, affectedCount: queries.length };
    });
  }
}
