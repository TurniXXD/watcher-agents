import {
  errorMessage,
  stockThesisStateSchema,
  type StockThesisState,
} from '@watcher/core';
import type { DatabaseClient } from './client.js';
import { RunStatus, ValidationTargetType } from './generated/prisma/enums.js';
import { nullableNumber, prismaJson } from './utils/json.js';
import {
  calculateCalibration,
  calculatePriceOutcome,
  probabilityMidpoint,
  type CalibrationBucket,
  type ValidationPricePoint,
} from './stock-domain/validation.js';
import {
  buildBacktestSummary,
  buildSignalPerformance,
  type BacktestSummary,
  type SignalPerformance,
} from './stock-domain/validation-report.js';

const TWO_HOURS = 2 * 60 * 60_000;
const PRICE_LOOKBACK_DAYS = 7;
const PRICE_LOOKAHEAD_DAYS = 395;

export type HistoricalEvent = {
  id: string;
  detectedAt: Date;
  publishedAt: Date;
  eventType: string;
  title: string;
  materiality: string;
  source: string;
};

export type HistoricalReplay = {
  ticker: string;
  companyName: string | null;
  asOf: Date;
  price: { observedAt: Date; close: number } | null;
  thesis: StockThesisState | null;
  events: HistoricalEvent[];
};

export type EventReplayEntry = {
  timestamp: Date;
  kind: 'EVENT' | 'THESIS_REVISION';
  eventType: string;
  title: string;
  verdict: string | null;
  attention: number | null;
};

export type EventReplay = {
  ticker: string;
  from: Date | null;
  to: Date;
  entries: EventReplayEntry[];
};

export type ValidationExecution =
  | {
      status: 'SUCCESS';
      runId: string;
      targetCount: number;
      outcomeCount: number;
      durationMs: number;
    }
  | { status: 'BUSY' }
  | { status: 'FAILED'; runId: string; error: string; durationMs: number };

type ValidationTarget = {
  type: (typeof ValidationTargetType)[keyof typeof ValidationTargetType];
  id: string;
  ticker: string;
  anchorAt: Date;
  state: StockThesisState | null;
  sector: string | null;
  catalyst: string | null;
  signalType: string | null;
};

const parsedState = (value: unknown): StockThesisState | null => {
  const parsed = stockThesisStateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

const stateSignals = (state: StockThesisState | null): string[] =>
  state?.signalGroups
    .filter((group) => group.availability === 'AVAILABLE' && group.score !== 0)
    .map((group) => group.group)
    .sort() ?? [];

export class ValidationStore {
  public constructor(private readonly db: DatabaseClient) {}

  public async analyzeAsOf(
    chatConfigId: string,
    ticker: string,
    asOf: Date,
  ): Promise<HistoricalReplay | null> {
    const normalizedTicker = ticker.trim().toUpperCase();
    const stock = await this.db.stock.findUnique({
      where: {
        chatConfigId_symbol: { chatConfigId, symbol: normalizedTicker },
      },
      select: { companyName: true },
    });
    if (!stock) return null;

    const [events, revision, price] = await Promise.all([
      this.db.canonicalEvent.findMany({
        where: {
          ticker: normalizedTicker,
          firstDetectedAt: { lte: asOf },
          primaryEvidence: { publishedAt: { lte: asOf } },
          observations: {
            some: {
              run: { watcherConfig: { chatConfigId } },
              processedItem: { publishedAt: { lte: asOf } },
            },
          },
        },
        orderBy: { firstDetectedAt: 'asc' },
        select: {
          id: true,
          firstDetectedAt: true,
          eventType: true,
          title: true,
          materiality: true,
          primaryEvidence: { select: { publishedAt: true, source: true } },
        },
      }),
      this.db.thesisRevision.findFirst({
        where: {
          ticker: normalizedTicker,
          createdAt: { lte: asOf },
          processedItem: { publishedAt: { lte: asOf } },
          event: {
            firstDetectedAt: { lte: asOf },
            observations: {
              some: { run: { watcherConfig: { chatConfigId } } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        select: { resultingState: true },
      }),
      this.db.marketSnapshot.findFirst({
        where: { ticker: normalizedTicker, observedAt: { lte: asOf } },
        orderBy: { observedAt: 'desc' },
        select: { observedAt: true, close: true },
      }),
    ]);

    return {
      ticker: normalizedTicker,
      companyName: stock.companyName,
      asOf,
      price: price
        ? { observedAt: price.observedAt, close: Number(price.close) }
        : null,
      thesis: revision ? parsedState(revision.resultingState) : null,
      events: events.flatMap((event) =>
        event.primaryEvidence.publishedAt
          ? [
              {
                id: event.id,
                detectedAt: event.firstDetectedAt,
                publishedAt: event.primaryEvidence.publishedAt,
                eventType: event.eventType,
                title: event.title,
                materiality: event.materiality,
                source: event.primaryEvidence.source,
              },
            ]
          : [],
      ),
    };
  }

  public async replayEvents(
    chatConfigId: string,
    ticker: string,
    from: Date | null,
    to: Date,
  ): Promise<EventReplay | null> {
    const normalizedTicker = ticker.trim().toUpperCase();
    const stock = await this.db.stock.findUnique({
      where: {
        chatConfigId_symbol: { chatConfigId, symbol: normalizedTicker },
      },
      select: { id: true },
    });
    if (!stock) return null;
    const events = await this.db.canonicalEvent.findMany({
      where: {
        ticker: normalizedTicker,
        firstDetectedAt: { lte: to, ...(from ? { gte: from } : {}) },
        primaryEvidence: { publishedAt: { lte: to } },
        observations: {
          some: { run: { watcherConfig: { chatConfigId } } },
        },
      },
      orderBy: { firstDetectedAt: 'asc' },
      include: { thesisRevision: true },
    });
    const entries: EventReplayEntry[] = [];
    for (const event of events) {
      entries.push({
        timestamp: event.firstDetectedAt,
        kind: 'EVENT',
        eventType: event.eventType,
        title: event.title,
        verdict: null,
        attention: null,
      });
      const revision = event.thesisRevision;
      if (revision && revision.createdAt <= to) {
        const state = parsedState(revision.resultingState);
        entries.push({
          timestamp: revision.createdAt,
          kind: 'THESIS_REVISION',
          eventType: event.eventType,
          title: revision.thesisChange,
          verdict: state?.verdict ?? null,
          attention: state?.attentionScore ?? null,
        });
      }
    }
    entries.sort(
      (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
    );
    return { ticker: normalizedTicker, from, to, entries };
  }

  public async runValidation(
    watcherConfigId: string,
  ): Promise<ValidationExecution> {
    const startedAt = new Date();
    const run = await this.db.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM "WatcherConfig" WHERE id = ${watcherConfigId} FOR UPDATE`;
      const existing = await transaction.validationRun.findFirst({
        where: {
          watcherConfigId,
          status: RunStatus.RUNNING,
          startedAt: { gt: new Date(startedAt.getTime() - TWO_HOURS) },
        },
        select: { id: true },
      });
      return existing
        ? null
        : transaction.validationRun.create({ data: { watcherConfigId } });
    });
    if (!run) return { status: 'BUSY' };

    try {
      const targets = await this.loadTargets(watcherConfigId);
      const prices = await this.loadPrices(targets);
      let outcomeCount = 0;
      for (const target of targets) {
        const outcome = calculatePriceOutcome(
          target.anchorAt,
          prices.get(target.ticker) ?? [],
        );
        const signalCombination = stateSignals(target.state);
        await this.db.backtestOutcome.upsert({
          where: {
            watcherConfigId_targetType_targetId: {
              watcherConfigId,
              targetType: target.type,
              targetId: target.id,
            },
          },
          create: {
            watcherConfigId,
            targetType: target.type,
            targetId: target.id,
            ticker: target.ticker,
            anchorAt: target.anchorAt,
            ...outcome,
            signalCombination: prismaJson(signalCombination),
            verdict: target.state?.verdict ?? null,
            sector: target.sector,
            catalyst: target.catalyst,
            signalType: target.signalType,
            confidence: target.state?.confidence ?? null,
            attention: target.state?.attentionScore ?? null,
            predictedThirtyDayProbability: probabilityMidpoint(
              target.state?.decision?.probabilityHigher.thirtyDays,
            ),
          },
          update: {
            anchorAt: target.anchorAt,
            ...outcome,
            signalCombination: prismaJson(signalCombination),
            verdict: target.state?.verdict ?? null,
            sector: target.sector,
            catalyst: target.catalyst,
            signalType: target.signalType,
            confidence: target.state?.confidence ?? null,
            attention: target.state?.attentionScore ?? null,
            predictedThirtyDayProbability: probabilityMidpoint(
              target.state?.decision?.probabilityHigher.thirtyDays,
            ),
          },
        });
        if (outcome.anchorPrice !== null) outcomeCount += 1;
      }
      await this.db.validationRun.update({
        where: { id: run.id },
        data: {
          status: RunStatus.SUCCESS,
          finishedAt: new Date(),
          targetCount: targets.length,
          outcomeCount,
        },
      });
      return {
        status: 'SUCCESS',
        runId: run.id,
        targetCount: targets.length,
        outcomeCount,
        durationMs: Date.now() - startedAt.getTime(),
      };
    } catch (error) {
      const message = errorMessage(error);
      await this.db.validationRun.update({
        where: { id: run.id },
        data: {
          status: RunStatus.FAILED,
          finishedAt: new Date(),
          error: message,
        },
      });
      return {
        status: 'FAILED',
        runId: run.id,
        error: message,
        durationMs: Date.now() - startedAt.getTime(),
      };
    }
  }

  public async getBacktestSummary(
    watcherConfigId: string,
  ): Promise<BacktestSummary> {
    const raw = await this.db.backtestOutcome.findMany({
      where: { watcherConfigId },
    });
    return buildBacktestSummary(raw, ValidationTargetType.ALERT);
  }

  public async getCalibration(
    watcherConfigId: string,
  ): Promise<CalibrationBucket[]> {
    const outcomes = await this.db.backtestOutcome.findMany({
      where: { watcherConfigId, targetType: ValidationTargetType.THESIS },
      select: {
        predictedThirtyDayProbability: true,
        returnThirtyDayPercent: true,
      },
    });
    return calculateCalibration(
      outcomes.map((outcome) => ({
        predictedPercent: outcome.predictedThirtyDayProbability,
        returnPercent: nullableNumber(outcome.returnThirtyDayPercent),
      })),
    );
  }

  public async getSignalPerformance(
    watcherConfigId: string,
    minimumSampleSize: number,
  ): Promise<SignalPerformance[]> {
    return buildSignalPerformance(
      await this.db.backtestOutcome.findMany({
        where: { watcherConfigId, targetType: ValidationTargetType.SIGNAL },
      }),
      minimumSampleSize,
    );
  }

  private async loadTargets(
    watcherConfigId: string,
  ): Promise<ValidationTarget[]> {
    const config = await this.db.watcherConfig.findUniqueOrThrow({
      where: { id: watcherConfigId },
      select: {
        chatConfigId: true,
        chatConfig: {
          select: { stocks: { select: { symbol: true, sector: true } } },
        },
      },
    });
    const sectors = new Map(
      config.chatConfig.stocks.map((stock) => [stock.symbol, stock.sector]),
    );
    const observationScope = {
      some: { run: { watcherConfigId } },
    } as const;
    const [revisions, alerts, events] = await Promise.all([
      this.db.thesisRevision.findMany({
        where: { event: { observations: observationScope } },
        include: { event: { include: { catalysts: true } } },
      }),
      this.db.stockAlert.findMany({
        where: { watcherConfigId },
        include: {
          event: { include: { thesisRevision: true, catalysts: true } },
        },
      }),
      this.db.canonicalEvent.findMany({
        where: { observations: observationScope },
        include: { thesisRevision: true, catalysts: true },
      }),
    ]);
    return [
      ...revisions.map((revision) => ({
        type: ValidationTargetType.THESIS,
        id: revision.id,
        ticker: revision.ticker,
        anchorAt: revision.createdAt,
        state: parsedState(revision.resultingState),
        sector: sectors.get(revision.ticker) ?? null,
        catalyst: revision.event.catalysts[0]?.catalystType ?? null,
        signalType: revision.event.eventType,
      })),
      ...alerts.map((alert) => ({
        type: ValidationTargetType.ALERT,
        id: alert.id,
        ticker: alert.ticker,
        anchorAt: alert.eventDetectedAt,
        state: parsedState(alert.event.thesisRevision?.resultingState),
        sector: sectors.get(alert.ticker) ?? null,
        catalyst: alert.event.catalysts[0]?.catalystType ?? null,
        signalType: alert.type,
      })),
      ...events.map((event) => ({
        type: ValidationTargetType.SIGNAL,
        id: event.id,
        ticker: event.ticker,
        anchorAt: event.firstDetectedAt,
        state: parsedState(event.thesisRevision?.resultingState),
        sector: sectors.get(event.ticker) ?? null,
        catalyst: event.catalysts[0]?.catalystType ?? null,
        signalType: event.eventType,
      })),
    ];
  }

  private async loadPrices(
    targets: readonly ValidationTarget[],
  ): Promise<Map<string, ValidationPricePoint[]>> {
    if (!targets.length) return new Map();
    const earliest = Math.min(
      ...targets.map((target) => target.anchorAt.getTime()),
    );
    const latest = Math.max(
      ...targets.map((target) => target.anchorAt.getTime()),
    );
    const snapshots = await this.db.marketSnapshot.findMany({
      where: {
        ticker: { in: [...new Set(targets.map((target) => target.ticker))] },
        observedAt: {
          gte: new Date(earliest - PRICE_LOOKBACK_DAYS * 24 * 60 * 60_000),
          lte: new Date(latest + PRICE_LOOKAHEAD_DAYS * 24 * 60 * 60_000),
        },
      },
      orderBy: { observedAt: 'asc' },
    });
    const byTicker = new Map<string, ValidationPricePoint[]>();
    for (const snapshot of snapshots) {
      const current = byTicker.get(snapshot.ticker) ?? [];
      current.push({
        observedAt: snapshot.observedAt,
        open: Number(snapshot.open),
        high: Number(snapshot.high),
        low: Number(snapshot.low),
        close: Number(snapshot.close),
        ninetyDayReturnPercent: nullableNumber(snapshot.ninetyDayReturnPercent),
      });
      byTicker.set(snapshot.ticker, current);
    }
    return byTicker;
  }
}
