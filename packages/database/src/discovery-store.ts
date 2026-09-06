import { type RunIntelligenceSummary } from '@watcher/core';
import {
  investigationExpiryDecision,
  type DiscoveryCandidate,
  type DiscoveryScanMode,
} from './stock-domain/discovery.js';
import { randomUUID } from 'node:crypto';
import type { DatabaseClient } from './client.js';
import {
  DiscoverySignalStatus,
  Materiality,
  MonitoringMode,
  MonitoringTier,
  RunStatus,
  RunTrigger,
  WatcherKind,
} from './generated/prisma/enums.js';
import { defaultStockSourceTypes } from './stock-source-defaults.js';
import { stockSourceSettingsForChat } from './utils/source-settings.js';

export type DiscoveryLifecycleOptions = {
  investigationMs: number;
  highResolutionIntervalMs: number;
  eventModeMs: number;
  watchMs: number;
};

export type DiscoveryCompanyProfile = {
  symbol: string;
  companyName: string;
  cik: string;
  exchange: string | null;
  industry: string | null;
  investorRelationsUrl: string | null;
};

export type DueDiscoveryScan = {
  id: string;
  chatId: bigint;
};

export type DueHighResolutionRun = {
  id: string;
  chatId: bigint;
  tickers: string[];
};

export type DiscoveryStatus = {
  lastScanAt: Date | null;
  nextScanAt: Date | null;
  scanInProgress: boolean;
  investigations: Array<{
    ticker: string;
    companyName: string | null;
    attentionScore: number;
    investigateUntil: Date | null;
    reason: string | null;
  }>;
  recentSignals: Array<{
    ticker: string;
    changePercent: number;
    volume: bigint;
    attentionScore: number;
    status: DiscoverySignalStatus;
    observedAt: Date;
  }>;
};

const staleScanBefore = (now: Date): Date =>
  new Date(now.getTime() - 30 * 60_000);
const attentionOnlyEventTypes = new Set([
  'PRICE_ANOMALY',
  'VOLUME_ANOMALY',
  'OPTIONS_ANOMALY',
  'SHORT_INTEREST_CHANGE',
  'OFF_EXCHANGE_ANOMALY',
  'CONGRESSIONAL_TRANSACTION',
]);

export class StockDiscoveryStore {
  public constructor(
    private readonly db: DatabaseClient,
    private readonly options: DiscoveryLifecycleOptions,
  ) {}

  public async initializeSchedules(
    scanIntervalMs: number,
    now = new Date(),
  ): Promise<void> {
    await this.db.watcherConfig.updateMany({
      where: {
        nextDiscoveryScanAt: null,
        chatConfig: { kind: WatcherKind.STOCKS },
      },
      data: { nextDiscoveryScanAt: new Date(now.getTime() + scanIntervalMs) },
    });
  }

  public listDueScans(now: Date): Promise<DueDiscoveryScan[]> {
    return this.db.watcherConfig
      .findMany({
        where: {
          enabled: true,
          nextDiscoveryScanAt: { lte: now },
          OR: [
            { discoveryScanInProgress: false },
            { discoveryScanStartedAt: { lt: staleScanBefore(now) } },
          ],
          chatConfig: { kind: WatcherKind.STOCKS },
        },
        select: { id: true, chatConfig: { select: { chatId: true } } },
      })
      .then((rows) =>
        rows.map((row) => ({ id: row.id, chatId: row.chatConfig.chatId })),
      );
  }

  public async claimScan(
    watcherConfigId: string,
    trigger: 'MANUAL' | 'SCHEDULED',
    mode: DiscoveryScanMode,
    now = new Date(),
  ) {
    return this.db.$transaction(async (transaction) => {
      const claimed = await transaction.watcherConfig.updateMany({
        where: {
          id: watcherConfigId,
          OR: [
            { discoveryScanInProgress: false },
            { discoveryScanStartedAt: { lt: staleScanBefore(now) } },
          ],
        },
        data: { discoveryScanInProgress: true, discoveryScanStartedAt: now },
      });
      if (claimed.count === 0) {
        return undefined;
      }
      await transaction.discoveryScan.updateMany({
        where: {
          watcherConfigId,
          status: RunStatus.RUNNING,
          startedAt: { lt: staleScanBefore(now) },
        },
        data: {
          status: RunStatus.FAILED,
          error: 'Recovered stale discovery scan lock',
          finishedAt: now,
        },
      });
      return transaction.discoveryScan.create({
        data: {
          watcherConfigId,
          trigger:
            trigger === 'MANUAL' ? RunTrigger.MANUAL : RunTrigger.SCHEDULED,
          mode,
          startedAt: now,
        },
      });
    });
  }

  public async finishScan(
    watcherConfigId: string,
    scanId: string,
    result: {
      status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
      observedCount?: number;
      candidateCount?: number;
      activatedCount?: number;
      error?: string;
    },
    scanIntervalMs: number,
    now = new Date(),
  ): Promise<void> {
    await this.db.$transaction([
      this.db.discoveryScan.update({
        where: { id: scanId },
        data: {
          status: RunStatus[result.status],
          observedCount: result.observedCount ?? 0,
          candidateCount: result.candidateCount ?? 0,
          activatedCount: result.activatedCount ?? 0,
          ...(result.error ? { error: result.error.slice(0, 2_000) } : {}),
          finishedAt: now,
        },
      }),
      this.db.watcherConfig.update({
        where: { id: watcherConfigId },
        data: {
          discoveryScanInProgress: false,
          discoveryScanStartedAt: null,
          lastDiscoveryScanAt: now,
          nextDiscoveryScanAt: new Date(now.getTime() + scanIntervalMs),
        },
      }),
    ]);
  }

  public async activateCandidate(
    watcherConfigId: string,
    scanId: string,
    candidate: DiscoveryCandidate,
    profile: DiscoveryCompanyProfile,
    now = new Date(),
  ): Promise<{ activated: boolean; ticker: string }> {
    const config = await this.db.watcherConfig.findUniqueOrThrow({
      where: { id: watcherConfigId },
      select: { chatConfigId: true },
    });
    const sourceSettings = await stockSourceSettingsForChat(
      this.db,
      config.chatConfigId,
    );
    const enabledBySource = new Map(
      sourceSettings.map(({ source, enabled }) => [source, enabled]),
    );
    return this.db.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${watcherConfigId}), hashtext(${candidate.ticker}))`;
      const existingSignal = await transaction.discoverySignal.findUnique({
        where: {
          watcherConfigId_fingerprint: {
            watcherConfigId,
            fingerprint: candidate.fingerprint,
          },
        },
      });
      if (existingSignal) {
        return { activated: false, ticker: candidate.ticker };
      }
      const existing = await transaction.stock.findUnique({
        where: {
          chatConfigId_symbol: {
            chatConfigId: config.chatConfigId,
            symbol: candidate.ticker,
          },
        },
      });
      const investigationUntil = new Date(
        now.getTime() + this.options.investigationMs,
      );
      const shouldInvestigate =
        !existing ||
        (existing.enabled &&
          (existing.monitoringTier === MonitoringTier.DISCOVERY ||
            existing.monitoringTier === MonitoringTier.INVESTIGATE));
      const shouldEscalateExisting =
        existing?.enabled === true &&
        (existing.monitoringTier === MonitoringTier.WATCH ||
          existing.monitoringTier === MonitoringTier.CORE) &&
        existing.monitoringMode !== MonitoringMode.EVENT_MODE;
      const stock = existing
        ? await transaction.stock.update({
            where: { id: existing.id },
            data: {
              attentionScore: Math.max(
                existing.attentionScore,
                candidate.attentionScore,
              ),
              lastDiscoverySignalAt: candidate.observedAt,
              ...(shouldInvestigate
                ? {
                    monitoringTier: MonitoringTier.INVESTIGATE,
                    monitoringMode: MonitoringMode.HIGH_RESOLUTION,
                    investigationStartedAt:
                      existing.investigationStartedAt ?? now,
                    investigateUntil: investigationUntil,
                    highResolutionUntil: investigationUntil,
                    nextHighResolutionCheckAt: now,
                    watchReason: candidate.reason,
                  }
                : {}),
              ...(shouldEscalateExisting
                ? {
                    monitoringMode: MonitoringMode.HIGH_RESOLUTION,
                    highResolutionUntil: investigationUntil,
                    nextHighResolutionCheckAt: now,
                  }
                : {}),
            },
          })
        : await transaction.stock.create({
            data: {
              chatConfigId: config.chatConfigId,
              symbol: profile.symbol,
              companyName: profile.companyName,
              cik: profile.cik,
              exchange: profile.exchange,
              industry: profile.industry,
              investorRelationsUrl: profile.investorRelationsUrl,
              enabled: true,
              monitoringTier: MonitoringTier.INVESTIGATE,
              monitoringMode: MonitoringMode.HIGH_RESOLUTION,
              priority: candidate.attentionScore,
              watchReason: candidate.reason,
              autoDiscovered: true,
              attentionScore: candidate.attentionScore,
              investigationStartedAt: now,
              investigateUntil: investigationUntil,
              highResolutionUntil: investigationUntil,
              lastDiscoverySignalAt: candidate.observedAt,
              nextHighResolutionCheckAt: now,
              sources: {
                create: defaultStockSourceTypes.map((source) => ({
                  source,
                  enabled: enabledBySource.get(source) ?? true,
                })),
              },
            },
          });
      const activated = shouldInvestigate || shouldEscalateExisting;
      await transaction.discoverySignal.create({
        data: {
          watcherConfigId,
          scanId,
          stockId: stock.id,
          fingerprint: candidate.fingerprint,
          ticker: candidate.ticker,
          source: candidate.source,
          trigger: candidate.trigger,
          observedAt: candidate.observedAt,
          price: candidate.price,
          changePercent: candidate.changePercent,
          volume: BigInt(candidate.volume),
          dollarVolume: candidate.dollarVolume,
          attentionScore: candidate.attentionScore,
          reason: candidate.reason,
          status: activated
            ? DiscoverySignalStatus.INVESTIGATING
            : DiscoverySignalStatus.OBSERVED,
        },
      });
      await transaction.domainEvent.create({
        data: {
          id: randomUUID(),
          type: activated
            ? 'discovery.investigation_started'
            : 'discovery.candidate_observed',
          aggregateType: 'COMPANY',
          aggregateId: stock.id,
          occurredAt: now,
          payload: {
            ticker: candidate.ticker,
            changePercent: candidate.changePercent,
            volume: candidate.volume,
            attentionScore: candidate.attentionScore,
            previousTier: existing?.monitoringTier ?? null,
            monitoringTier: stock.monitoringTier,
            monitoringMode: stock.monitoringMode,
          },
        },
      });
      return { activated, ticker: stock.symbol };
    });
  }

  public async promoteMaterialEvents(
    chatConfigId: string,
    intelligence: RunIntelligenceSummary | undefined,
    now = new Date(),
  ): Promise<string[]> {
    const material = intelligence?.events.filter(
      ({ eventType, materiality }) =>
        !attentionOnlyEventTypes.has(eventType) &&
        (materiality === 'HIGH' || materiality === 'EXTREME'),
    );
    if (!material?.length) {
      return [];
    }
    const promoted: string[] = [];
    for (const event of material) {
      await this.db.$transaction(async (transaction) => {
        const stock = await transaction.stock.findUnique({
          where: {
            chatConfigId_symbol: { chatConfigId, symbol: event.ticker },
          },
        });
        if (!stock || !stock.enabled) {
          return;
        }
        const promotion =
          stock.monitoringTier === MonitoringTier.INVESTIGATE ||
          stock.monitoringTier === MonitoringTier.DISCOVERY;
        const updated = await transaction.stock.update({
          where: { id: stock.id },
          data: {
            monitoringTier: promotion
              ? MonitoringTier.WATCH
              : stock.monitoringTier,
            monitoringMode: MonitoringMode.EVENT_MODE,
            priority: Math.max(stock.priority, 90),
            attentionScore:
              event.materiality === 'EXTREME'
                ? 100
                : Math.max(90, stock.attentionScore),
            ...(promotion
              ? {
                  watchReason: event.title,
                  watchUntil: new Date(now.getTime() + this.options.watchMs),
                  watchStartedAt: now,
                  investigationStartedAt: null,
                  investigateUntil: null,
                }
              : {}),
            highResolutionUntil: new Date(
              now.getTime() + this.options.eventModeMs,
            ),
            nextHighResolutionCheckAt: now,
          },
        });
        await transaction.discoverySignal.updateMany({
          where: {
            stockId: stock.id,
            status: DiscoverySignalStatus.INVESTIGATING,
          },
          data: { status: DiscoverySignalStatus.PROMOTED },
        });
        await transaction.domainEvent.create({
          data: {
            id: randomUUID(),
            type: promotion
              ? 'discovery.promoted_to_watch'
              : 'discovery.event_mode_started',
            aggregateType: 'COMPANY',
            aggregateId: stock.id,
            occurredAt: now,
            payload: {
              ticker: updated.symbol,
              eventId: event.eventId,
              materiality: event.materiality,
              monitoringTier: updated.monitoringTier,
              monitoringMode: updated.monitoringMode,
              watchUntil: updated.watchUntil?.toISOString() ?? null,
            },
          },
        });
        promoted.push(updated.symbol);
      });
    }
    return [...new Set(promoted)];
  }

  public async escalateAttentionSignals(
    chatConfigId: string,
    intelligence: RunIntelligenceSummary | undefined,
    now = new Date(),
  ): Promise<string[]> {
    const signals = intelligence?.events.filter(
      ({ eventType, materiality }) =>
        attentionOnlyEventTypes.has(eventType) &&
        (materiality === 'MEDIUM' ||
          materiality === 'HIGH' ||
          materiality === 'EXTREME'),
    );
    if (!signals?.length) return [];
    const escalated: string[] = [];
    for (const signal of signals) {
      await this.db.$transaction(async (transaction) => {
        const stock = await transaction.stock.findUnique({
          where: {
            chatConfigId_symbol: { chatConfigId, symbol: signal.ticker },
          },
        });
        if (!stock?.enabled) return;
        const investigationUntil = new Date(
          now.getTime() + this.options.investigationMs,
        );
        const discoveryTier =
          stock.monitoringTier === MonitoringTier.DISCOVERY ||
          stock.monitoringTier === MonitoringTier.INVESTIGATE;
        const updated = await transaction.stock.update({
          where: { id: stock.id },
          data: {
            monitoringTier: discoveryTier
              ? MonitoringTier.INVESTIGATE
              : stock.monitoringTier,
            monitoringMode: MonitoringMode.HIGH_RESOLUTION,
            attentionScore: Math.max(
              stock.attentionScore,
              signal.materiality === 'EXTREME'
                ? 95
                : signal.materiality === 'HIGH'
                  ? 80
                  : 65,
            ),
            investigationStartedAt: stock.investigationStartedAt ?? now,
            investigateUntil: investigationUntil,
            highResolutionUntil: investigationUntil,
            nextHighResolutionCheckAt: now,
            ...(discoveryTier ? { watchReason: signal.title } : {}),
          },
        });
        await transaction.domainEvent.create({
          data: {
            id: randomUUID(),
            type: 'signal.attention_escalated',
            aggregateType: 'COMPANY',
            aggregateId: stock.id,
            occurredAt: now,
            payload: {
              ticker: updated.symbol,
              eventId: signal.eventId,
              eventType: signal.eventType,
              materiality: signal.materiality,
              monitoringTier: updated.monitoringTier,
              monitoringMode: updated.monitoringMode,
              cause: 'UNKNOWN_OR_UNCONFIRMED',
            },
          },
        });
        escalated.push(updated.symbol);
      });
    }
    return [...new Set(escalated)];
  }

  public async reconcileExpired(now = new Date()): Promise<{
    returnedToDiscovery: number;
    normalizedMode: number;
    expiredWatch: number;
  }> {
    const stocks = await this.db.stock.findMany({
      where: {
        enabled: true,
        OR: [
          { investigateUntil: { lte: now } },
          { highResolutionUntil: { lte: now } },
          { watchUntil: { lte: now } },
        ],
      },
    });
    let returnedToDiscovery = 0;
    let normalizedMode = 0;
    let expiredWatch = 0;
    for (const stock of stocks) {
      const decision = investigationExpiryDecision({
        tier: stock.monitoringTier,
        mode: stock.monitoringMode,
        investigateUntil: stock.investigateUntil,
        highResolutionUntil: stock.highResolutionUntil,
        now,
      });
      if (decision.action === 'RETURN_TO_DISCOVERY') {
        const transitioned = await this.transitionExpiredStock(
          stock.id,
          stock.symbol,
          now,
          {
            monitoringTier: MonitoringTier.DISCOVERY,
            monitoringMode: MonitoringMode.LOW_RESOLUTION,
            attentionScore: 0,
            watchReason: null,
            investigationStartedAt: null,
            investigateUntil: null,
            highResolutionUntil: null,
            nextHighResolutionCheckAt: null,
          },
          'discovery.investigation_expired',
          decision.reason,
          {
            monitoringTier: MonitoringTier.INVESTIGATE,
            investigateUntil: { lte: now },
          },
        );
        if (transitioned) {
          await this.db.discoverySignal.updateMany({
            where: {
              stockId: stock.id,
              status: DiscoverySignalStatus.INVESTIGATING,
            },
            data: { status: DiscoverySignalStatus.EXPIRED },
          });
          returnedToDiscovery += 1;
        }
        continue;
      }
      if (
        stock.monitoringTier === MonitoringTier.WATCH &&
        stock.watchUntil &&
        stock.watchUntil <= now
      ) {
        const renewedEvent = stock.watchStartedAt
          ? await this.db.canonicalEvent.findFirst({
              where: {
                ticker: stock.symbol,
                materiality: {
                  in: [Materiality.HIGH, Materiality.EXTREME],
                },
                firstDetectedAt: { gt: stock.watchStartedAt },
              },
              orderBy: { firstDetectedAt: 'desc' },
            })
          : null;
        if (renewedEvent) {
          await this.transitionExpiredStock(
            stock.id,
            stock.symbol,
            now,
            {
              watchStartedAt: now,
              watchUntil: new Date(now.getTime() + this.options.watchMs),
              watchReason: renewedEvent.title,
            },
            'discovery.watch_extended',
            'A newer high-materiality event renewed the watch reason.',
            {
              monitoringTier: MonitoringTier.WATCH,
              watchUntil: { lte: now },
            },
          );
          continue;
        }
        const transitioned = await this.transitionExpiredStock(
          stock.id,
          stock.symbol,
          now,
          {
            monitoringTier: MonitoringTier.DISCOVERY,
            monitoringMode: MonitoringMode.LOW_RESOLUTION,
            attentionScore: 0,
            watchReason: null,
            watchUntil: null,
            watchStartedAt: null,
            highResolutionUntil: null,
            nextHighResolutionCheckAt: null,
          },
          'discovery.watch_expired',
          'Watch reason expired without a renewed material event.',
          {
            monitoringTier: MonitoringTier.WATCH,
            watchUntil: { lte: now },
          },
        );
        if (transitioned) {
          expiredWatch += 1;
        }
        continue;
      }
      if (decision.action === 'NORMALIZE_WATCH_MODE') {
        const transitioned = await this.transitionExpiredStock(
          stock.id,
          stock.symbol,
          now,
          {
            monitoringMode: MonitoringMode.NORMAL,
            highResolutionUntil: null,
            nextHighResolutionCheckAt: null,
          },
          'discovery.high_resolution_expired',
          decision.reason,
          {
            monitoringMode: stock.monitoringMode,
            highResolutionUntil: { lte: now },
          },
        );
        if (transitioned) {
          await this.db.discoverySignal.updateMany({
            where: {
              stockId: stock.id,
              status: DiscoverySignalStatus.INVESTIGATING,
            },
            data: { status: DiscoverySignalStatus.EXPIRED },
          });
          normalizedMode += 1;
        }
      }
    }
    return { returnedToDiscovery, normalizedMode, expiredWatch };
  }

  private async transitionExpiredStock(
    stockId: string,
    ticker: string,
    now: Date,
    data: Parameters<DatabaseClient['stock']['update']>[0]['data'],
    eventType: string,
    reason: string,
    expected: NonNullable<
      Parameters<DatabaseClient['stock']['updateMany']>[0]['where']
    >,
  ): Promise<boolean> {
    return this.db.$transaction(async (transaction) => {
      const transition = await transaction.stock.updateMany({
        where: { id: stockId, ...expected },
        data,
      });
      if (transition.count === 0) {
        return false;
      }
      await transaction.domainEvent.create({
        data: {
          id: randomUUID(),
          type: eventType,
          aggregateType: 'COMPANY',
          aggregateId: stockId,
          occurredAt: now,
          payload: { ticker, reason },
        },
      });
      return true;
    });
  }

  public async claimDueHighResolutionRuns(
    now = new Date(),
  ): Promise<DueHighResolutionRun[]> {
    return this.db.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(8643921772)`;
      const stocks = await transaction.stock.findMany({
        where: {
          enabled: true,
          monitoringMode: {
            in: [MonitoringMode.HIGH_RESOLUTION, MonitoringMode.EVENT_MODE],
          },
          highResolutionUntil: { gt: now },
          OR: [
            { nextHighResolutionCheckAt: null },
            { nextHighResolutionCheckAt: { lte: now } },
          ],
          chatConfig: { watcherConfig: { is: { enabled: true } } },
        },
        select: {
          id: true,
          symbol: true,
          chatConfig: {
            select: {
              chatId: true,
              watcherConfig: { select: { id: true } },
            },
          },
        },
      });
      if (stocks.length === 0) {
        return [];
      }
      await transaction.stock.updateMany({
        where: { id: { in: stocks.map(({ id }) => id) } },
        data: {
          lastHighResolutionCheckAt: now,
          nextHighResolutionCheckAt: new Date(
            now.getTime() + this.options.highResolutionIntervalMs,
          ),
        },
      });
      const grouped = new Map<string, DueHighResolutionRun>();
      for (const stock of stocks) {
        const config = stock.chatConfig.watcherConfig;
        if (!config) {
          continue;
        }
        const current = grouped.get(config.id);
        if (current) {
          current.tickers.push(stock.symbol);
        } else {
          grouped.set(config.id, {
            id: config.id,
            chatId: stock.chatConfig.chatId,
            tickers: [stock.symbol],
          });
        }
      }
      return [...grouped.values()];
    });
  }

  public async status(chatConfigId: string): Promise<DiscoveryStatus> {
    const config = await this.db.watcherConfig.findUniqueOrThrow({
      where: { chatConfigId },
    });
    const [investigations, signals] = await Promise.all([
      this.db.stock.findMany({
        where: {
          chatConfigId,
          monitoringTier: MonitoringTier.INVESTIGATE,
        },
        orderBy: { attentionScore: 'desc' },
        take: 20,
      }),
      this.db.discoverySignal.findMany({
        where: { watcherConfigId: config.id },
        orderBy: { observedAt: 'desc' },
        take: 10,
      }),
    ]);
    return {
      lastScanAt: config.lastDiscoveryScanAt,
      nextScanAt: config.nextDiscoveryScanAt,
      scanInProgress: config.discoveryScanInProgress,
      investigations: investigations.map((stock) => ({
        ticker: stock.symbol,
        companyName: stock.companyName,
        attentionScore: stock.attentionScore,
        investigateUntil: stock.investigateUntil,
        reason: stock.watchReason,
      })),
      recentSignals: signals.map((signal) => ({
        ticker: signal.ticker,
        changePercent: Number(signal.changePercent),
        volume: signal.volume,
        attentionScore: signal.attentionScore,
        status: signal.status,
        observedAt: signal.observedAt,
      })),
    };
  }
}
