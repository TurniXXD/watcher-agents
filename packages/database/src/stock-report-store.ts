import { randomUUID } from 'node:crypto';
import type { DatabaseClient } from './client.js';
import { PROVIDER_BACKOFF_TARGET } from './source-health-store.js';
import { average } from './stock-domain/statistics.js';

const firstByTicker = <T extends { ticker: string }>(values: T[]) => {
  const result = new Map<string, T>();
  for (const value of values) {
    if (!result.has(value.ticker)) result.set(value.ticker, value);
  }
  return result;
};

const averageRounded = (values: number[]): number | null => {
  const mean = average(values);
  return mean === null ? null : Math.round(mean);
};

export class StockReportStore {
  public constructor(private readonly db: DatabaseClient) {}

  public getStockThesis(ticker: string) {
    return this.db.companyThesisState.findUnique({
      where: { ticker: ticker.trim().toUpperCase() },
    });
  }

  public async claimPendingAlerts(watcherConfigId: string, now = new Date()) {
    const staleBefore = new Date(now.getTime() - 10 * 60_000);
    return this.db.$transaction(async (transaction) => {
      const alerts = await transaction.stockAlert.findMany({
        where: {
          watcherConfigId,
          sentAt: null,
          OR: [
            { deliveryClaimedAt: null },
            { deliveryClaimedAt: { lt: staleBefore } },
          ],
        },
        orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }],
        take: 20,
        include: {
          event: {
            select: {
              primaryEvidence: {
                select: { source: true, sourceUrl: true, url: true },
              },
            },
          },
        },
      });
      if (alerts.length === 0) return [];
      await transaction.stockAlert.updateMany({
        where: { id: { in: alerts.map(({ id }) => id) }, sentAt: null },
        data: {
          deliveryClaimedAt: now,
          deliveryAttempts: { increment: 1 },
        },
      });
      return alerts;
    });
  }

  public async markAlertDelivered(alertId: string, now = new Date()) {
    return this.db.$transaction(async (transaction) => {
      const alert = await transaction.stockAlert.update({
        where: { id: alertId },
        data: {
          sentAt: now,
          deliveryClaimedAt: null,
          deliveryError: null,
        },
      });
      await transaction.domainEvent.create({
        data: {
          id: randomUUID(),
          type: 'alert.sent',
          aggregateType: 'ALERT',
          aggregateId: alert.id,
          occurredAt: now,
          payload: {
            ticker: alert.ticker,
            eventId: alert.eventId,
            analysisToAlertLatencyMs:
              now.getTime() - alert.analysisCompletedAt.getTime(),
            totalAlertLatencyMs:
              now.getTime() - alert.eventDetectedAt.getTime(),
          },
        },
      });
      return alert;
    });
  }

  public markAlertDeliveryFailed(alertId: string, error: string) {
    return this.db.stockAlert.update({
      where: { id: alertId },
      data: {
        deliveryClaimedAt: null,
        deliveryError: error.slice(0, 2_000),
      },
    });
  }

  public listRecentAlerts(chatConfigId: string, take = 20) {
    return this.db.stockAlert.findMany({
      where: { watcherConfig: { chatConfigId } },
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        event: {
          select: {
            primaryEvidence: {
              select: { source: true, sourceUrl: true, url: true },
            },
          },
        },
      },
    });
  }

  public async getStockDashboard(chatConfigId: string) {
    const stocks = await this.db.stock.findMany({
      where: { chatConfigId, enabled: true },
      orderBy: { symbol: 'asc' },
    });
    const tickers = stocks.map(({ symbol }) => symbol);
    if (tickers.length === 0) return [];
    const [states, prices, catalysts, events, revisions] = await Promise.all([
      this.db.companyThesisState.findMany({
        where: { ticker: { in: tickers } },
      }),
      this.db.marketSnapshot.findMany({
        where: { ticker: { in: tickers } },
        orderBy: { observedAt: 'desc' },
      }),
      this.db.catalyst.findMany({
        where: {
          ticker: { in: tickers },
          status: { in: ['UPCOMING', 'ACTIVE'] },
        },
        orderBy: [{ expectedStart: 'asc' }, { impact: 'desc' }],
      }),
      this.db.canonicalEvent.findMany({
        where: { ticker: { in: tickers } },
        orderBy: { firstDetectedAt: 'desc' },
      }),
      this.db.thesisRevision.findMany({
        where: { ticker: { in: tickers } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const stateByTicker = new Map(states.map((state) => [state.ticker, state]));
    const priceByTicker = firstByTicker(prices);
    const catalystByTicker = firstByTicker(catalysts);
    const eventByTicker = firstByTicker(events);
    const revisionByTicker = firstByTicker(revisions);
    return stocks
      .map((stock) => ({
        stock,
        thesis: stateByTicker.get(stock.symbol) ?? null,
        price: priceByTicker.get(stock.symbol) ?? null,
        catalyst: catalystByTicker.get(stock.symbol) ?? null,
        lastEvent: eventByTicker.get(stock.symbol) ?? null,
        lastRevision: revisionByTicker.get(stock.symbol) ?? null,
      }))
      .sort(
        (left, right) =>
          (right.thesis?.attentionScore ?? right.stock.attentionScore) -
          (left.thesis?.attentionScore ?? left.stock.attentionScore),
      );
  }

  public async getObservabilitySnapshot(configId: string) {
    const [
      config,
      runs,
      health,
      pendingAlerts,
      alertCount,
      duplicateCount,
      queueDepth,
      recentlyAnalyzedEvents,
      recentlySentAlerts,
    ] = await Promise.all([
      this.db.watcherConfig.findUniqueOrThrow({ where: { id: configId } }),
      this.db.watcherRun.findMany({
        where: { watcherConfigId: configId },
        orderBy: { startedAt: 'desc' },
        take: 20,
        include: { analyses: true, sourceFailures: true },
      }),
      this.db.sourceHealth.findMany({
        where: {
          watcherConfigId: configId,
          target: { not: PROVIDER_BACKOFF_TARGET },
        },
        orderBy: [{ status: 'desc' }, { source: 'asc' }],
      }),
      this.db.stockAlert.count({
        where: { watcherConfigId: configId, sentAt: null },
      }),
      this.db.stockAlert.count({ where: { watcherConfigId: configId } }),
      this.db.eventObservation.count({
        where: { run: { watcherConfigId: configId }, decision: 'DUPLICATE' },
      }),
      this.db.canonicalEvent.count({
        where: {
          analysisClaimedAt: { not: null },
          analysisCompletedAt: null,
          observations: { some: { run: { watcherConfigId: configId } } },
        },
      }),
      this.db.canonicalEvent.findMany({
        where: {
          analysisCompletedAt: { not: null },
          observations: { some: { run: { watcherConfigId: configId } } },
        },
        orderBy: { analysisCompletedAt: 'desc' },
        take: 100,
        select: { firstDetectedAt: true, analysisCompletedAt: true },
      }),
      this.db.stockAlert.findMany({
        where: { watcherConfigId: configId, sentAt: { not: null } },
        orderBy: { sentAt: 'desc' },
        take: 100,
        select: { analysisCompletedAt: true, sentAt: true },
      }),
    ]);
    const analyses = runs.flatMap((run) => run.analyses);
    const sourceFailures = runs.flatMap((run) => run.sourceFailures);
    const successfulRuns = runs.filter(
      ({ status }) => status === 'SUCCESS' || status === 'PARTIAL',
    );
    const healthySources = health.filter(
      ({ status }) => status === 'HEALTHY',
    ).length;
    return {
      runInProgress: config.runInProgress,
      lastSuccessfulPoll: successfulRuns[0]?.finishedAt ?? null,
      lastRunStatus: config.lastRunStatus,
      nextRunAt: config.nextRunAt,
      lastReconciliationAt: config.lastReconciliationAt,
      nextReconciliationAt: config.nextReconciliationAt,
      reconciliationInProgress: config.reconciliationInProgress,
      sourceHealth: health,
      pendingAlerts,
      alertsGenerated: alertCount,
      duplicatesPrevented: duplicateCount,
      analysisQueueDepth: queueDepth,
      sourceFailures: sourceFailures.length,
      failedAnalyses: analyses.filter(({ status }) => status === 'FAILED')
        .length,
      rateLimitedSources: health.filter(
        ({ status }) => status === 'RATE_LIMITED',
      ).length,
      sourceCoveragePercent:
        health.length === 0
          ? 100
          : Math.round((healthySources / health.length) * 100),
      llmCalls: analyses.reduce((total, row) => total + row.llmCallCount, 0),
      promptTokens: analyses.reduce(
        (total, row) => total + (row.promptTokens ?? 0),
        0,
      ),
      completionTokens: analyses.reduce(
        (total, row) => total + (row.completionTokens ?? 0),
        0,
      ),
      estimatedLlmCostUsd: analyses.reduce(
        (total, row) => total + Number(row.estimatedCostUsd),
        0,
      ),
      averageAnalysisDurationMs:
        analyses.filter(({ durationMs }) => durationMs !== null).length === 0
          ? null
          : Math.round(
              analyses.reduce(
                (total, row) => total + (row.durationMs ?? 0),
                0,
              ) /
                analyses.filter(({ durationMs }) => durationMs !== null).length,
            ),
      averageEventAnalysisLatencyMs: averageRounded(
        recentlyAnalyzedEvents.flatMap((event) =>
          event.analysisCompletedAt
            ? [
                event.analysisCompletedAt.getTime() -
                  event.firstDetectedAt.getTime(),
              ]
            : [],
        ),
      ),
      averageAlertDeliveryLatencyMs: averageRounded(
        recentlySentAlerts.flatMap((alert) =>
          alert.sentAt
            ? [alert.sentAt.getTime() - alert.analysisCompletedAt.getTime()]
            : [],
        ),
      ),
    };
  }
}
