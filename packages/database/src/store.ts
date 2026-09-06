import { randomUUID } from 'node:crypto';
import {
  computeNextRun,
  contentHash,
  decisionResultSchema,
  normalizeObservation,
  stockIntelligenceResultSchema,
  stockThesisStateSchema,
  watchItemSchema,
  type AnalysisOutcome,
  type PipelineRepository,
  type PreparedItem,
  type WatcherKind as CoreWatcherKind,
  type WatchItem,
  publicationAnalysisSchema,
  stockAnalysisSchema,
} from '@watcher/core';
import {
  defaultMarketAnomalyPolicy,
  type MarketAnomalyPolicy,
} from './stock-domain/specialized.js';
import {
  defaultAdvancedSignalPolicy,
  type AdvancedSignalPolicy,
} from './stock-domain/advanced.js';
import { evaluateStockAlert } from './stock-domain/alerting.js';
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
import { prismaJson } from './utils/json.js';
import { SourceHealthStore } from './source-health-store.js';
import { StockEventStore } from './stock-event-store.js';
import { StockReportStore } from './stock-report-store.js';
import { ConfigurationStore } from './configuration-store.js';

const DEFAULT_SCHEDULE = '0 8 * * *';
const DEFAULT_TIMEZONE = 'Europe/Prague';
const LOCAL_MODEL_RESOURCE = 'HEAVY_LOCAL_MODEL';
const kindValue = (kind: CoreWatcherKind): WatcherKind =>
  kind === 'STOCKS' ? WatcherKind.STOCKS : WatcherKind.PUBLICATIONS;
const identityKey = (item: { source: string; externalId: string }): string =>
  `${item.source}\u0000${item.externalId}`;

export type WatcherStoreOptions = {
  eventCooldownMs?: number;
  tickerCooldownMs?: number;
  sourceBackoffBaseMs?: number;
  sourceBackoffMaximumMs?: number;
  marketAnomalyPolicy?: Partial<MarketAnomalyPolicy>;
  advancedSignalPolicy?: Partial<AdvancedSignalPolicy>;
  availableStockSourceIds?: ReadonlySet<string>;
  alertAttentionThreshold?: number;
};

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
  private readonly stockEvents: StockEventStore;
  private readonly sourceHealth: SourceHealthStore;
  private readonly stockReports: StockReportStore;
  private readonly configuration: ConfigurationStore;
  private readonly alertAttentionThreshold: number;

  public constructor(
    private readonly db: DatabaseClient,
    options: WatcherStoreOptions = {},
  ) {
    this.stockEvents = new StockEventStore(db, {
      eventCooldownMs: options.eventCooldownMs ?? 6 * 60 * 60_000,
      tickerCooldownMs: options.tickerCooldownMs ?? 30 * 60_000,
      marketAnomalyPolicy: {
        ...defaultMarketAnomalyPolicy,
        ...options.marketAnomalyPolicy,
      },
      advancedSignalPolicy: {
        ...defaultAdvancedSignalPolicy,
        ...options.advancedSignalPolicy,
      },
      ...(options.availableStockSourceIds
        ? { availableSourceIds: options.availableStockSourceIds }
        : {}),
    });
    this.sourceHealth = new SourceHealthStore(db, {
      baseBackoffMs: options.sourceBackoffBaseMs ?? 60_000,
      maximumBackoffMs: options.sourceBackoffMaximumMs ?? 6 * 60 * 60_000,
    });
    this.stockReports = new StockReportStore(db);
    this.configuration = new ConfigurationStore(db);
    this.alertAttentionThreshold = options.alertAttentionThreshold ?? 85;
  }

  public async ensureChat(
    kind: CoreWatcherKind,
    chatId: bigint,
    timezone = DEFAULT_TIMEZONE,
  ) {
    const existing = await this.getChat(kind, chatId);
    if (existing?.watcherConfig) {
      return existing;
    }
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
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LOCAL_MODEL_RESOURCE}))`;
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
      if (claimed.count === 0) {
        return undefined;
      }
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
    if (items.length === 0) {
      return [];
    }
    const safeItems = items.map((item) => watchItemSchema.parse(item));
    const run = await this.db.watcherRun.findUniqueOrThrow({
      where: { id: runId },
      select: {
        watcherConfigId: true,
        watcherConfig: { select: { chatConfigId: true } },
      },
    });
    const identityFilters = safeItems.map((item) => ({
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
    const selectedNewItems: WatchItem[] =
      kind === 'STOCKS'
        ? safeItems.filter((item) => !existingByIdentity.has(identityKey(item)))
        : [];
    let remainingAnalysisSlots = maxAnalyses === 0 ? Infinity : maxAnalyses;

    for (const item of kind === 'STOCKS' ? [] : safeItems) {
      const key = identityKey(item);
      const processedItem = existingByIdentity.get(key);
      const deliveredToThisWatcher = processedItem?.analyses.some(
        (analysis) => analysis.run.watcherConfigId === run.watcherConfigId,
      );
      if (deliveredToThisWatcher) {
        continue;
      }
      const latestSuccess = processedItem?.analyses[0];
      if (latestSuccess?.result) {
        continue;
      }
      if (remainingAnalysisSlots <= 0) {
        continue;
      }
      selectedForAnalysis.add(key);
      if (!processedItem) selectedNewItems.push(item);
      remainingAnalysisSlots -= 1;
    }

    const observations = new Map(
      selectedNewItems.map((item) => [
        identityKey(item),
        normalizeObservation(kind, item),
      ]),
    );
    const created = await this.db.$transaction(async (transaction) => {
      const rows = await transaction.processedItem.createManyAndReturn({
        skipDuplicates: true,
        data: selectedNewItems.map((item) => {
          const observation = observations.get(identityKey(item));
          if (!observation) {
            throw new Error('Normalized observation missing');
          }
          return {
            watcherKind: kindValue(kind),
            source: item.source,
            externalId: item.externalId,
            title: item.title,
            url: item.url,
            publishedAt: observation.publishedAt,
            ticker: observation.ticker,
            sourceType: observation.sourceType,
            sourceUrl: observation.sourceUrl,
            primarySource: observation.primarySource,
            discoveredAt: observation.discoveredAt,
            eventAt: observation.eventAt,
            category: observation.category,
            headline: observation.headline,
            rawText: observation.rawText,
            normalizedFacts: prismaJson(observation.normalizedFacts),
            entities: observation.entities,
            reliability: observation.reliability,
            contentHash: contentHash(item.content),
            metadata: prismaJson(item.metadata),
          };
        }),
      });
      if (rows.length > 0) {
        await transaction.domainEvent.createMany({
          data: rows.map((row) => ({
            id: randomUUID(),
            type: 'observation.discovered',
            aggregateType: 'OBSERVATION',
            aggregateId: row.id,
            occurredAt: row.discoveredAt,
            payload: {
              watcherKind: kind,
              ticker: row.ticker,
              source: row.source,
              externalId: row.externalId,
              publishedAt: row.publishedAt?.toISOString() ?? null,
            },
          })),
        });
      }
      return rows;
    });
    const createdByIdentity = new Map(
      created.map((item) => [identityKey(item), item]),
    );
    if (kind === 'STOCKS') {
      const companies = await this.db.stock.findMany({
        where: {
          chatConfigId: run.watcherConfig.chatConfigId,
          symbol: {
            in: safeItems.flatMap((item) => {
              const symbol = item.metadata.symbol;
              return typeof symbol === 'string' ? [symbol.toUpperCase()] : [];
            }),
          },
        },
        select: { symbol: true, marketCap: true },
      });
      const companyContext = new Map(
        companies.map((company) => [
          company.symbol,
          {
            marketCapUsd:
              company.marketCap === null ? null : Number(company.marketCap),
          },
        ]),
      );
      const persisted = await this.db.processedItem.findMany({
        where: {
          watcherKind: WatcherKind.STOCKS,
          OR: identityFilters,
        },
      });
      const persistedByIdentity = new Map(
        persisted.map((item) => [identityKey(item), item]),
      );
      const prepared: PreparedItem[] = [];
      for (const item of safeItems) {
        const key = identityKey(item);
        const processedItem = existingByIdentity.get(key);
        const deliveredToThisWatcher = processedItem?.analyses.some(
          (analysis) => analysis.run.watcherConfigId === run.watcherConfigId,
        );
        if (deliveredToThisWatcher) continue;
        const latestSuccess = processedItem?.analyses[0];
        const record = persistedByIdentity.get(key);
        if (!record) continue;
        if (latestSuccess?.result) {
          prepared.push({
            recordId: record.id,
            item,
            outcome: cachedOutcome(kind, latestSuccess.result),
          });
          continue;
        }
        const event = await this.stockEvents.recordObservation(
          runId,
          record.id,
          item,
          record.discoveredAt,
          companyContext.get(record.ticker ?? ''),
        );
        if (!event?.eligibleForAnalysis || remainingAnalysisSlots <= 0) {
          continue;
        }
        if (await this.stockEvents.claimAnalysis(event)) {
          const stockAnalysisContext =
            await this.stockEvents.getAnalysisContext(
              event.eventId,
              run.watcherConfigId,
            );
          prepared.push({
            recordId: record.id,
            item: {
              ...item,
              metadata: { ...item.metadata, stockAnalysisContext },
            },
          });
          remainingAnalysisSlots -= 1;
        }
      }
      return prepared;
    }
    return safeItems.flatMap((item) => {
      const key = identityKey(item);
      const processedItem = existingByIdentity.get(key);
      const deliveredToThisWatcher = processedItem?.analyses.some(
        (analysis) => analysis.run.watcherConfigId === run.watcherConfigId,
      );
      if (deliveredToThisWatcher) {
        return [];
      }
      const latestSuccess = processedItem?.analyses[0];
      if (processedItem && latestSuccess?.result)
        return [
          {
            recordId: processedItem.id,
            item,
            outcome: cachedOutcome(kind, latestSuccess.result),
          },
        ];
      if (!selectedForAnalysis.has(key)) {
        return [];
      }
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
    await this.db.$transaction(async (transaction) => {
      const completedAt = new Date();
      const analysis = await transaction.analysis.create({
        data: {
          runId,
          processedItemId: itemId,
          status:
            outcome.status === 'SUCCESS'
              ? AnalysisStatus.SUCCESS
              : AnalysisStatus.FAILED,
          ...(outcome.status === 'SUCCESS'
            ? { result: prismaJson(outcome.result) }
            : { error: outcome.error }),
          ...(outcome.metrics?.durationMs === undefined
            ? {}
            : { durationMs: outcome.metrics.durationMs }),
          llmCallCount: outcome.metrics?.llmCallCount ?? 0,
          ...(outcome.metrics?.promptTokens === undefined
            ? {}
            : { promptTokens: outcome.metrics.promptTokens }),
          ...(outcome.metrics?.completionTokens === undefined
            ? {}
            : { completionTokens: outcome.metrics.completionTokens }),
          estimatedCostUsd: outcome.metrics?.estimatedCostUsd ?? 0,
        },
      });
      if (outcome.status === 'SUCCESS') {
        await transaction.canonicalEvent.updateMany({
          where: { observations: { some: { processedItemId: itemId } } },
          data: { analysisCompletedAt: completedAt },
        });
        const intelligence =
          'intelligence' in outcome.result
            ? stockIntelligenceResultSchema.safeParse(
                outcome.result.intelligence,
              )
            : null;
        if (intelligence?.success) {
          const result = intelligence.data;
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${result.state.ticker}), hashtext('COMPANY_THESIS'))`;
          const existingRevision = await transaction.thesisRevision.findUnique({
            where: { eventId: result.eventId },
            select: { id: true },
          });
          if (!existingRevision) {
            const previousState =
              await transaction.companyThesisState.findUnique({
                where: { ticker: result.state.ticker },
              });
            const { decision, ...persistentState } = result.state;
            await transaction.companyThesisState.upsert({
              where: { ticker: result.state.ticker },
              create: {
                ...persistentState,
                signalGroups: prismaJson(result.state.signalGroups),
                catalysts: prismaJson(result.state.catalysts),
                primaryDrivers: prismaJson(result.state.primaryDrivers),
                risks: prismaJson(result.state.risks),
                materialDataGaps: prismaJson(result.state.materialDataGaps),
                ...(decision === undefined || decision === null
                  ? {}
                  : { decision: prismaJson(decision) }),
                lastEventId: result.eventId,
              },
              update: {
                thesis: result.state.thesis,
                verdict: result.state.verdict,
                confidence: result.state.confidence,
                attentionScore: result.state.attentionScore,
                bullScore: result.state.bullScore,
                bearScore: result.state.bearScore,
                netSignal: result.state.netSignal,
                signalGroups: prismaJson(result.state.signalGroups),
                catalysts: prismaJson(result.state.catalysts),
                insiderConviction: result.state.insiderConviction,
                pricedIn: result.state.pricedIn,
                primaryDrivers: prismaJson(result.state.primaryDrivers),
                risks: prismaJson(result.state.risks),
                dataCoverage: result.state.dataCoverage,
                dataQuality: result.state.dataQuality,
                materialDataGaps: prismaJson(result.state.materialDataGaps),
                ...(decision === undefined || decision === null
                  ? {}
                  : { decision: prismaJson(decision) }),
                lastEventId: result.eventId,
                version: { increment: 1 },
              },
            });
            await transaction.thesisRevision.create({
              data: {
                ticker: result.state.ticker,
                eventId: result.eventId,
                processedItemId: itemId,
                analysisId: analysis.id,
                thesisChange: result.targeted.thesisChange,
                informationChange: result.targeted.informationChange,
                fullAnalysisPerformed: result.fullAnalysisPerformed,
                redundancyClass: result.redundancyClass,
                redundancyMultiplier: result.redundancyMultiplier,
                reliabilityWeight: result.reliabilityWeight,
                targetedAnalysis: prismaJson(result.targeted),
                resultingState: prismaJson(result.state),
              },
            });
            await transaction.domainEvent.create({
              data: {
                id: randomUUID(),
                type: 'thesis.updated',
                aggregateType: 'COMPANY',
                aggregateId: result.state.ticker,
                occurredAt: new Date(),
                payload: {
                  eventId: result.eventId,
                  thesisChange: result.targeted.thesisChange,
                  informationChange: result.targeted.informationChange,
                  verdict: result.state.verdict,
                  attentionScore: result.state.attentionScore,
                  netSignal: result.state.netSignal,
                  dataCoverage: result.state.dataCoverage,
                },
              },
            });
            const event = await transaction.canonicalEvent.findUniqueOrThrow({
              where: { id: result.eventId },
              include: {
                primaryEvidence: true,
                catalysts: {
                  where: {
                    impact: 'EXTREME',
                    status: { in: ['UPCOMING', 'ACTIVE'] },
                  },
                },
              },
            });
            const previousDecision = decisionResultSchema.safeParse(
              previousState?.decision,
            );
            const previousVerdict = previousState
              ? stockThesisStateSchema.shape.verdict.safeParse(
                  previousState.verdict,
                )
              : null;
            const alert = evaluateStockAlert(
              {
                eventType: event.eventType,
                materiality: event.materiality,
                title: event.title,
                magnitude:
                  typeof event.magnitude === 'object' &&
                  event.magnitude !== null &&
                  !Array.isArray(event.magnitude)
                    ? event.magnitude
                    : {},
                hasExtremeCatalyst: event.catalysts.length > 0,
              },
              result,
              previousState && previousVerdict?.success
                ? {
                    verdict: previousVerdict.data,
                    attentionScore: previousState.attentionScore,
                    decision: previousDecision.success
                      ? previousDecision.data
                      : null,
                  }
                : null,
              this.alertAttentionThreshold,
            );
            if (alert) {
              const run = await transaction.watcherRun.findUniqueOrThrow({
                where: { id: runId },
                select: { watcherConfigId: true },
              });
              const createdAlert = await transaction.stockAlert.create({
                data: {
                  watcherConfigId: run.watcherConfigId,
                  runId,
                  eventId: event.id,
                  ticker: event.ticker,
                  type: alert.type,
                  severity: alert.severity,
                  title: alert.title,
                  reasons: prismaJson(alert.reasons),
                  snapshot: prismaJson({
                    eventType: event.eventType,
                    eventTitle: event.title,
                    materiality: event.materiality,
                    detectedAt: event.firstDetectedAt.toISOString(),
                    source: event.primaryEvidence.source,
                    sourceUrl:
                      event.primaryEvidence.sourceUrl ??
                      event.primaryEvidence.url,
                    thesisChange: result.targeted.thesisChange,
                    previousVerdict: previousState?.verdict ?? null,
                    verdict: result.state.verdict,
                    attentionScore: result.state.attentionScore,
                    netSignal: result.state.netSignal,
                    dataCoverage: result.state.dataCoverage,
                    pricedIn:
                      result.decision?.pricedIn.classification ??
                      result.state.pricedIn,
                    recommendation:
                      result.decision?.recommendation ?? result.state.verdict,
                    expectedValuePercent:
                      result.decision?.expectedValuePercent ?? null,
                    primaryDriver: result.targeted.primaryDriver,
                    magnitude: event.magnitude,
                  }),
                  eventDetectedAt: event.firstDetectedAt,
                  analysisCompletedAt: completedAt,
                },
              });
              await transaction.domainEvent.create({
                data: {
                  id: randomUUID(),
                  type: 'alert.created',
                  aggregateType: 'ALERT',
                  aggregateId: createdAlert.id,
                  occurredAt: completedAt,
                  payload: {
                    ticker: event.ticker,
                    eventId: event.id,
                    alertType: alert.type,
                    severity: alert.severity,
                  },
                },
              });
            }
          }
        }
      }
    });
  }

  public getStockThesis(ticker: string) {
    return this.stockReports.getStockThesis(ticker);
  }

  public async claimPendingAlerts(watcherConfigId: string, now = new Date()) {
    return this.stockReports.claimPendingAlerts(watcherConfigId, now);
  }

  public async markAlertDelivered(alertId: string, now = new Date()) {
    return this.stockReports.markAlertDelivered(alertId, now);
  }

  public markAlertDeliveryFailed(alertId: string, error: string) {
    return this.stockReports.markAlertDeliveryFailed(alertId, error);
  }

  public listRecentAlerts(chatConfigId: string, take = 20) {
    return this.stockReports.listRecentAlerts(chatConfigId, take);
  }

  public async getStockDashboard(chatConfigId: string) {
    return this.stockReports.getStockDashboard(chatConfigId);
  }

  public async getObservabilitySnapshot(configId: string) {
    return this.stockReports.getObservabilitySnapshot(configId);
  }

  public listDueReconciliations(kind: CoreWatcherKind, now: Date) {
    return this.db.watcherConfig.findMany({
      where: {
        enabled: true,
        reconciliationInProgress: false,
        nextReconciliationAt: { lte: now },
        chatConfig: { kind: kindValue(kind) },
      },
      select: { id: true, chatConfig: { select: { chatId: true } } },
    });
  }

  public async claimReconciliation(configId: string, now = new Date()) {
    const staleBefore = new Date(now.getTime() - 2 * 60 * 60_000);
    const claimed = await this.db.watcherConfig.updateMany({
      where: {
        id: configId,
        OR: [
          { reconciliationInProgress: false },
          { reconciliationStartedAt: { lt: staleBefore } },
        ],
      },
      data: { reconciliationInProgress: true, reconciliationStartedAt: now },
    });
    if (claimed.count === 0) return false;
    await this.db.sourceHealth.updateMany({
      where: { watcherConfigId: configId },
      data: { backoffUntil: null },
    });
    return true;
  }

  public async finishReconciliation(
    configId: string,
    status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'BUSY',
    intervalMs: number,
    now = new Date(),
  ) {
    const retryMs = status === 'BUSY' ? 15 * 60_000 : intervalMs;
    return this.db.$transaction(async (transaction) => {
      const updated = await transaction.watcherConfig.update({
        where: { id: configId },
        data: {
          reconciliationInProgress: false,
          reconciliationStartedAt: null,
          ...(status === 'BUSY' ? {} : { lastReconciliationAt: now }),
          nextReconciliationAt: new Date(now.getTime() + retryMs),
        },
      });
      await transaction.domainEvent.create({
        data: {
          id: randomUUID(),
          type: 'reconciliation.completed',
          aggregateType: 'WATCHER',
          aggregateId: configId,
          occurredAt: now,
          payload: {
            status,
            nextReconciliationAt: updated.nextReconciliationAt?.toISOString(),
          },
        },
      });
      return updated;
    });
  }

  public sourceAttemptDecision(
    kind: CoreWatcherKind,
    runId: string,
    source: string,
    target: string,
    now: Date,
  ) {
    return this.sourceHealth.attemptDecision(kind, runId, source, target, now);
  }

  public recordSourceSuccess(
    kind: CoreWatcherKind,
    runId: string,
    source: string,
    target: string,
    now: Date,
  ) {
    return this.sourceHealth.success(kind, runId, source, target, now);
  }

  public recordSourceFailure(
    kind: CoreWatcherKind,
    runId: string,
    source: string,
    target: string,
    message: string,
    now: Date,
  ) {
    return this.sourceHealth.failure(kind, runId, source, target, message, now);
  }

  public getRunIntelligenceSummary(runId: string) {
    return this.stockEvents.getRunSummary(runId);
  }

  public async listStocks(chatConfigId: string) {
    return this.configuration.listStocks(chatConfigId);
  }

  public async listCatalysts(chatConfigId: string, ticker?: string) {
    const stocks = await this.db.stock.findMany({
      where: {
        chatConfigId,
        enabled: true,
        ...(ticker ? { symbol: ticker.trim().toUpperCase() } : {}),
      },
      select: { symbol: true },
    });
    if (stocks.length === 0) return [];
    return this.db.catalyst.findMany({
      where: {
        ticker: { in: stocks.map(({ symbol }) => symbol) },
        status: { in: ['UPCOMING', 'ACTIVE'] },
      },
      orderBy: [{ expectedStart: 'asc' }, { impact: 'desc' }],
      take: 50,
      include: {
        event: {
          select: {
            primaryEvidence: {
              select: { source: true, sourceUrl: true, primarySource: true },
            },
          },
        },
      },
    });
  }

  public async getAdvancedStockData(chatConfigId: string, ticker?: string) {
    const stocks = await this.db.stock.findMany({
      where: {
        chatConfigId,
        enabled: true,
        ...(ticker ? { symbol: ticker.trim().toUpperCase() } : {}),
      },
      select: { symbol: true, companyName: true },
      orderBy: { symbol: 'asc' },
    });
    return Promise.all(
      stocks.map(async (stock) => {
        const [options, institutional, shortInterest, regulatoryEvents] =
          await Promise.all([
            this.db.optionsSnapshot.findFirst({
              where: { ticker: stock.symbol },
              orderBy: { observedAt: 'desc' },
            }),
            this.db.institutionalSnapshot.findFirst({
              where: { ticker: stock.symbol },
              orderBy: { reportedAt: 'desc' },
            }),
            this.db.shortInterestSnapshot.findFirst({
              where: { ticker: stock.symbol },
              orderBy: { settlementDate: 'desc' },
            }),
            this.db.canonicalEvent.findMany({
              where: {
                ticker: stock.symbol,
                eventType: { in: ['CLINICAL_TRIAL', 'FDA_DECISION'] },
              },
              orderBy: { firstDetectedAt: 'desc' },
              take: 3,
              include: {
                primaryEvidence: {
                  select: { source: true, sourceUrl: true, url: true },
                },
              },
            }),
          ]);
        return {
          ...stock,
          options,
          institutional,
          shortInterest,
          regulatoryEvents,
        };
      }),
    );
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
    return this.configuration.updateStockCompany(stockId, company);
  }

  public removeStock(chatConfigId: string, symbol: string) {
    return this.configuration.removeStock(chatConfigId, symbol);
  }

  public async toggleStockSource(stockId: string, source: StockSourceType) {
    return this.configuration.toggleStockSource(stockId, source);
  }

  public async addQuery(chatConfigId: string, query: string) {
    return this.configuration.addQuery(chatConfigId, query);
  }

  public async addQueries(chatConfigId: string, queries: string[]) {
    return this.configuration.addQueries(chatConfigId, queries);
  }

  public listQueries(chatConfigId: string) {
    return this.configuration.listQueries(chatConfigId);
  }

  public removeQuery(chatConfigId: string, query: string) {
    return this.configuration.removeQuery(chatConfigId, query);
  }

  public async togglePublicationSource(
    queryId: string,
    source: PublicationSourceType,
  ) {
    return this.configuration.togglePublicationSource(queryId, source);
  }
}

export { PublicationSourceType, RunStatus, StockSourceType, WatcherKind };
