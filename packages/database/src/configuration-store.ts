import type { DatabaseClient } from './client.js';
import { PublicationSourceType } from './generated/prisma/enums.js';
import type { StockSourceType } from './generated/prisma/enums.js';
import { defaultStockSourceTypes } from './stock-source-defaults.js';

export class ConfigurationStore {
  public constructor(private readonly db: DatabaseClient) {}

  public async listStocks(chatConfigId: string) {
    const stocks = await this.db.stock.findMany({
      where: { chatConfigId },
      include: { sources: true },
      orderBy: { symbol: 'asc' },
    });
    const missingSources = stocks.flatMap((stock) => {
      const existing = new Set(stock.sources.map(({ source }) => source));
      return defaultStockSourceTypes.flatMap((source) =>
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

  public async toggleStockSource(stockId: string, source: StockSourceType) {
    const current = await this.db.stockSourceConfig.findUniqueOrThrow({
      where: { stockId_source: { stockId, source } },
    });
    return this.db.stockSourceConfig.update({
      where: { id: current.id },
      data: { enabled: !current.enabled },
    });
  }

  public addQuery(chatConfigId: string, query: string) {
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
    if (!normalizedQueries.length) {
      return { addedCount: 0, skippedCount: 0, totalCount: 0 };
    }
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
