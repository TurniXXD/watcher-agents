import { randomUUID } from 'node:crypto';
import type {
  CompanyStateUpdate,
  CompanyUniverseInput,
  CompanyUniverseRecord,
  CompanyUniverseRepository,
} from './stock-domain/universe.js';
import type { DatabaseClient } from './client.js';
import type { Stock } from './generated/prisma/client.js';
import { MonitoringMode, MonitoringTier } from './generated/prisma/enums.js';
import { defaultStockSourceTypes } from './stock-source-defaults.js';

const companyRecord = (stock: Stock): CompanyUniverseRecord => ({
  id: stock.id,
  chatConfigId: stock.chatConfigId,
  ticker: stock.symbol,
  companyName: stock.companyName ?? stock.symbol,
  cik: stock.cik,
  exchange: stock.exchange,
  sector: stock.sector,
  industry: stock.industry,
  marketCap: stock.marketCap === null ? null : Number(stock.marketCap),
  currency: stock.currency,
  country: stock.country,
  investorRelationsUrl: stock.investorRelationsUrl,
  enabled: stock.enabled,
  monitoringTier: stock.monitoringTier,
  monitoringMode: stock.monitoringMode,
  priority: stock.priority,
  tags: stock.tags,
  watchReason: stock.watchReason,
  watchUntil: stock.watchUntil,
});

export class CompanyUniverseStore implements CompanyUniverseRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public async createCompany(
    input: CompanyUniverseInput,
  ): Promise<CompanyUniverseRecord> {
    const stock = await this.db.$transaction(async (transaction) => {
      const created = await transaction.stock.create({
        data: {
          chatConfigId: input.chatConfigId,
          symbol: input.ticker,
          companyName: input.companyName,
          cik: input.cik,
          exchange: input.exchange,
          sector: input.sector,
          industry: input.industry,
          marketCap: input.marketCap,
          currency: input.currency,
          country: input.country,
          investorRelationsUrl: input.investorRelationsUrl,
          enabled: input.enabled,
          monitoringTier: MonitoringTier[input.monitoringTier],
          monitoringMode: MonitoringMode[input.monitoringMode],
          priority: input.priority,
          tags: input.tags,
          watchReason: input.watchReason,
          watchUntil: input.watchUntil,
          watchStartedAt: input.watchUntil ? new Date() : null,
          sources: {
            create: defaultStockSourceTypes.map((source) => ({
              source,
              enabled: true,
            })),
          },
        },
      });
      await transaction.domainEvent.create({
        data: {
          id: randomUUID(),
          type: 'company.added',
          aggregateType: 'COMPANY',
          aggregateId: created.id,
          occurredAt: new Date(),
          payload: {
            ticker: created.symbol,
            monitoringTier: created.monitoringTier,
            monitoringMode: created.monitoringMode,
          },
        },
      });
      return created;
    });
    return companyRecord(stock);
  }

  public async findCompany(
    chatConfigId: string,
    ticker: string,
  ): Promise<CompanyUniverseRecord | null> {
    const stock = await this.db.stock.findUnique({
      where: { chatConfigId_symbol: { chatConfigId, symbol: ticker } },
    });
    return stock ? companyRecord(stock) : null;
  }

  public async updateCompanyState(
    companyId: string,
    update: CompanyStateUpdate,
  ): Promise<CompanyUniverseRecord> {
    const stock = await this.db.$transaction(async (transaction) => {
      const previous = await transaction.stock.findUniqueOrThrow({
        where: { id: companyId },
      });
      const updated = await transaction.stock.update({
        where: { id: companyId },
        data: {
          ...(update.monitoringTier === undefined
            ? {}
            : { monitoringTier: MonitoringTier[update.monitoringTier] }),
          ...(update.monitoringMode === undefined
            ? {}
            : { monitoringMode: MonitoringMode[update.monitoringMode] }),
          ...(update.priority === undefined
            ? {}
            : { priority: update.priority }),
          ...(update.attentionScore === undefined
            ? {}
            : { attentionScore: update.attentionScore }),
          ...(update.enabled === undefined ? {} : { enabled: update.enabled }),
          ...(update.watchReason === undefined
            ? {}
            : { watchReason: update.watchReason }),
          ...(update.watchUntil === undefined
            ? {}
            : { watchUntil: update.watchUntil }),
          ...(update.watchStartedAt === undefined
            ? {}
            : { watchStartedAt: update.watchStartedAt }),
          ...(update.investigationStartedAt === undefined
            ? {}
            : { investigationStartedAt: update.investigationStartedAt }),
          ...(update.investigateUntil === undefined
            ? {}
            : { investigateUntil: update.investigateUntil }),
          ...(update.highResolutionUntil === undefined
            ? {}
            : { highResolutionUntil: update.highResolutionUntil }),
          ...(update.nextHighResolutionCheckAt === undefined
            ? {}
            : {
                nextHighResolutionCheckAt: update.nextHighResolutionCheckAt,
              }),
          ...(update.monitoringTier === 'WATCH' &&
          previous.monitoringTier !== MonitoringTier.WATCH &&
          update.watchStartedAt === undefined
            ? { watchStartedAt: new Date() }
            : {}),
          ...(update.watchUntil instanceof Date &&
          previous.watchStartedAt === null &&
          update.watchStartedAt === undefined
            ? { watchStartedAt: new Date() }
            : {}),
          ...(update.monitoringTier === 'DISCOVERY' &&
          update.watchStartedAt === undefined
            ? { watchStartedAt: null }
            : {}),
        },
      });
      await transaction.domainEvent.create({
        data: {
          id: randomUUID(),
          type: 'company.state_changed',
          aggregateType: 'COMPANY',
          aggregateId: updated.id,
          occurredAt: new Date(),
          payload: {
            ticker: updated.symbol,
            previousTier: previous.monitoringTier,
            monitoringTier: updated.monitoringTier,
            previousMode: previous.monitoringMode,
            monitoringMode: updated.monitoringMode,
          },
        },
      });
      return updated;
    });
    return companyRecord(stock);
  }
}
