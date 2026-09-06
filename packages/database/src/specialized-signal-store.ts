import { createHash } from 'node:crypto';
import {
  finiteNumber as numberValue,
  type NormalizedObservation,
} from '@watcher/core';
import {
  assessInstitutionalPositioning,
  assessOptionsPositioning,
  assessShortInterest,
  catalystFromEvent,
  classifyInsiderTransaction,
  detectMarketAnomaly,
  insiderClusterSize,
  materialityRank,
  marketAnomalyEvent,
  type AdvancedSignalPolicy,
  type CanonicalEventCandidate,
  type MarketAnomalyPolicy,
  type MarketPricePoint,
} from './stock-domain/index.js';
import type { DatabaseClient } from './client.js';
import {
  CatalystDirection,
  CatalystProximity,
  CatalystStatus,
  CatalystType,
  InsiderTransactionType,
  Materiality,
} from './generated/prisma/enums.js';
import { jsonObject, prismaJson } from './utils/json.js';

const marketPoint = (
  observation: NormalizedObservation,
): MarketPricePoint | null => {
  const open = numberValue(observation.normalizedFacts.open);
  const high = numberValue(observation.normalizedFacts.high);
  const low = numberValue(observation.normalizedFacts.low);
  const close = numberValue(observation.normalizedFacts.close);
  const volume = numberValue(observation.normalizedFacts.volume);
  const at = observation.eventAt ?? observation.publishedAt;
  if (
    !at ||
    open === null ||
    high === null ||
    low === null ||
    close === null ||
    close <= 0 ||
    volume === null ||
    volume < 0
  ) {
    return null;
  }
  return {
    at,
    open,
    high,
    low,
    close,
    volume: Math.round(volume),
    preMarketPrice: numberValue(observation.normalizedFacts.preMarketPrice),
    afterHoursPrice: numberValue(observation.normalizedFacts.afterHoursPrice),
    sectorReturnPercent: numberValue(
      observation.normalizedFacts.sectorReturnPercent,
    ),
    indexReturnPercent: numberValue(
      observation.normalizedFacts.indexReturnPercent,
    ),
  };
};

const insiderType = (
  value: ReturnType<typeof classifyInsiderTransaction>['transactionType'],
): InsiderTransactionType =>
  value === '10B5_1_SALE'
    ? InsiderTransactionType.TEN_B5_1_SALE
    : InsiderTransactionType[value];

const coreInsiderType = (
  value: InsiderTransactionType,
): ReturnType<typeof classifyInsiderTransaction>['transactionType'] =>
  value === InsiderTransactionType.TEN_B5_1_SALE ? '10B5_1_SALE' : value;

const catalystType = (value: string): CatalystType =>
  CatalystType[value as keyof typeof CatalystType];
const catalystProximity = (value: string): CatalystProximity =>
  CatalystProximity[value as keyof typeof CatalystProximity];
const catalystDirection = (value: string): CatalystDirection =>
  CatalystDirection[value as keyof typeof CatalystDirection];
const catalystStatus = (value: string): CatalystStatus =>
  CatalystStatus[value as keyof typeof CatalystStatus];

export class StockSpecializedSignalStore {
  public constructor(
    private readonly db: DatabaseClient,
    private readonly marketPolicy: MarketAnomalyPolicy,
    private readonly advancedPolicy: AdvancedSignalPolicy,
  ) {}

  public async enrichCandidate(
    processedItemId: string,
    observation: NormalizedObservation,
    candidate: CanonicalEventCandidate | null,
  ): Promise<CanonicalEventCandidate | null> {
    if (!observation.ticker) {
      return candidate;
    }
    if (observation.category === 'PRICE_SNAPSHOT') {
      return this.marketCandidate(processedItemId, observation);
    }
    if (observation.category === 'OFF_EXCHANGE_SNAPSHOT') {
      return this.offExchangeCandidate(processedItemId, observation);
    }
    if (observation.category === 'OPTIONS_SNAPSHOT') {
      return this.optionsCandidate(processedItemId, observation);
    }
    if (observation.category === 'INSTITUTIONAL_POSITIONING') {
      return this.institutionalCandidate(processedItemId, observation);
    }
    if (observation.category === 'SHORT_INTEREST_SNAPSHOT') {
      return this.shortInterestCandidate(processedItemId, observation);
    }
    if (observation.category === 'INSIDER_TRANSACTION' && candidate) {
      return this.insiderCandidate(processedItemId, observation, candidate);
    }
    return candidate;
  }

  private async optionsCandidate(
    processedItemId: string,
    observation: NormalizedObservation,
  ): Promise<CanonicalEventCandidate | null> {
    const callVolume = numberValue(observation.normalizedFacts.callVolume);
    const putVolume = numberValue(observation.normalizedFacts.putVolume);
    const callOpenInterest = numberValue(
      observation.normalizedFacts.callOpenInterest,
    );
    const putOpenInterest = numberValue(
      observation.normalizedFacts.putOpenInterest,
    );
    const observedAt = observation.eventAt ?? observation.publishedAt;
    if (
      !observation.ticker ||
      !observedAt ||
      callVolume === null ||
      putVolume === null ||
      callOpenInterest === null ||
      putOpenInterest === null
    ) {
      return null;
    }
    const history = await this.db.optionsSnapshot.findMany({
      where: { ticker: observation.ticker, observedAt: { lt: observedAt } },
      orderBy: { observedAt: 'desc' },
      take: 20,
      select: { callVolume: true, putVolume: true },
    });
    const maxVolumeOiRatio = numberValue(
      observation.normalizedFacts.maxVolumeOiRatio,
    );
    const assessment = assessOptionsPositioning(
      { callVolume, putVolume, maxVolumeOiRatio },
      history.map(
        (entry) => Number(entry.callVolume) + Number(entry.putVolume),
      ),
      this.advancedPolicy,
    );
    const putCallVolumeRatio = numberValue(
      observation.normalizedFacts.putCallVolumeRatio,
    );
    const putCallOpenInterestRatio = numberValue(
      observation.normalizedFacts.putCallOpenInterestRatio,
    );
    const meanImpliedVolatility = numberValue(
      observation.normalizedFacts.meanImpliedVolatility,
    );
    await this.db.optionsSnapshot.upsert({
      where: { processedItemId },
      create: {
        processedItemId,
        ticker: observation.ticker,
        observedAt,
        callVolume: BigInt(Math.round(callVolume)),
        putVolume: BigInt(Math.round(putVolume)),
        callOpenInterest: BigInt(Math.round(callOpenInterest)),
        putOpenInterest: BigInt(Math.round(putOpenInterest)),
        putCallVolumeRatio,
        putCallOpenInterestRatio,
        meanImpliedVolatility,
        maxVolumeOiRatio,
        anomaly: assessment.anomaly,
        reasons: prismaJson(assessment.reasons),
      },
      update: {},
    });
    if (!assessment.anomaly) return null;
    const fingerprint = createHash('sha256')
      .update(
        `${observation.ticker}:OPTIONS_ANOMALY:${observedAt.toISOString().slice(0, 10)}:${maxVolumeOiRatio ?? 'na'}`,
      )
      .digest('hex');
    return {
      ticker: observation.ticker,
      eventType: 'OPTIONS_ANOMALY',
      title: `Unusual options activity for ${observation.ticker}`,
      occurredAt: observedAt,
      firstPublicAt: observation.publishedAt,
      firstDetectedAt: observation.discoveredAt,
      direction: 'UNKNOWN',
      magnitude: {
        callVolume,
        putVolume,
        callOpenInterest,
        putOpenInterest,
        putCallVolumeRatio,
        putCallOpenInterestRatio,
        meanImpliedVolatility,
        maxVolumeOiRatio,
        volumeBaselineMultiple: assessment.volumeBaselineMultiple,
      },
      surprise: 'HIGH',
      materiality: 'MEDIUM',
      materialityScore: assessment.score,
      materialityReasons: assessment.reasons,
      action: 'TARGETED_ANALYSIS',
      fingerprint,
      evidencePriority: 55,
    };
  }

  private async institutionalCandidate(
    processedItemId: string,
    observation: NormalizedObservation,
  ): Promise<CanonicalEventCandidate | null> {
    const reportedAt = observation.eventAt ?? observation.publishedAt;
    if (!observation.ticker || !reportedAt) return null;
    const totalShares = numberValue(observation.normalizedFacts.totalShares);
    const totalValueUsd = numberValue(
      observation.normalizedFacts.totalValueUsd,
    );
    const netShareChange = numberValue(
      observation.normalizedFacts.netShareChange,
    );
    const changePercent = numberValue(
      observation.normalizedFacts.changePercent,
    );
    const holderCount = numberValue(observation.normalizedFacts.holderCount);
    const topHolders = Array.isArray(observation.normalizedFacts.topHolders)
      ? observation.normalizedFacts.topHolders
      : [];
    const assessment = assessInstitutionalPositioning(
      changePercent,
      this.advancedPolicy,
    );
    await this.db.institutionalSnapshot.upsert({
      where: { processedItemId },
      create: {
        processedItemId,
        ticker: observation.ticker,
        reportedAt,
        totalShares,
        totalValueUsd,
        netShareChange,
        changePercent,
        holderCount: holderCount === null ? null : Math.round(holderCount),
        topHolders: prismaJson(topHolders),
        materialChange: assessment.anomaly,
        reasons: prismaJson(assessment.reasons),
      },
      update: {},
    });
    if (!assessment.anomaly) return null;
    const direction =
      changePercent === null
        ? ('UNKNOWN' as const)
        : changePercent > 0
          ? ('POSITIVE' as const)
          : ('NEGATIVE' as const);
    return {
      ticker: observation.ticker,
      eventType: 'INSTITUTIONAL_POSITIONING',
      title: `Material institutional positioning change for ${observation.ticker}`,
      occurredAt: reportedAt,
      firstPublicAt: observation.publishedAt,
      firstDetectedAt: observation.discoveredAt,
      direction,
      magnitude: {
        totalShares,
        totalValueUsd,
        netShareChange,
        changePercent,
        holderCount,
      },
      surprise: 'MEDIUM',
      materiality: 'MEDIUM',
      materialityScore: assessment.score,
      materialityReasons: assessment.reasons,
      action: 'TARGETED_ANALYSIS',
      fingerprint: createHash('sha256')
        .update(
          `${observation.ticker}:INSTITUTIONAL_POSITIONING:${reportedAt.toISOString().slice(0, 10)}:${changePercent ?? 'na'}`,
        )
        .digest('hex'),
      evidencePriority: 55,
    };
  }

  private async shortInterestCandidate(
    processedItemId: string,
    observation: NormalizedObservation,
  ): Promise<CanonicalEventCandidate | null> {
    const settlementDate =
      observation.eventAt ?? observation.publishedAt ?? null;
    const currentShortPosition = numberValue(
      observation.normalizedFacts.currentShortPosition,
    );
    if (!observation.ticker || !settlementDate || currentShortPosition === null)
      return null;
    const previousShortPosition = numberValue(
      observation.normalizedFacts.previousShortPosition,
    );
    const changeShares = numberValue(observation.normalizedFacts.changeShares);
    const changePercent = numberValue(
      observation.normalizedFacts.changePercent,
    );
    const averageDailyVolume = numberValue(
      observation.normalizedFacts.averageDailyVolume,
    );
    const daysToCover = numberValue(observation.normalizedFacts.daysToCover);
    const assessment = assessShortInterest(
      { changePercent, daysToCover },
      this.advancedPolicy,
    );
    await this.db.shortInterestSnapshot.upsert({
      where: { processedItemId },
      create: {
        processedItemId,
        ticker: observation.ticker,
        settlementDate,
        currentShortPosition: BigInt(Math.round(currentShortPosition)),
        previousShortPosition:
          previousShortPosition === null
            ? null
            : BigInt(Math.round(previousShortPosition)),
        changeShares:
          changeShares === null ? null : BigInt(Math.round(changeShares)),
        changePercent,
        averageDailyVolume:
          averageDailyVolume === null
            ? null
            : BigInt(Math.round(averageDailyVolume)),
        daysToCover,
        materialChange: assessment.anomaly,
        reasons: prismaJson(assessment.reasons),
      },
      update: {},
    });
    if (!assessment.anomaly) return null;
    return {
      ticker: observation.ticker,
      eventType: 'SHORT_INTEREST_CHANGE',
      title: `Material short-interest change for ${observation.ticker}`,
      occurredAt: settlementDate,
      firstPublicAt: observation.publishedAt,
      firstDetectedAt: observation.discoveredAt,
      direction: 'UNKNOWN',
      magnitude: {
        currentShortPosition,
        previousShortPosition,
        changeShares,
        changePercent,
        averageDailyVolume,
        daysToCover,
      },
      surprise: 'MEDIUM',
      materiality: 'MEDIUM',
      materialityScore: assessment.score,
      materialityReasons: assessment.reasons,
      action: 'TARGETED_ANALYSIS',
      fingerprint: createHash('sha256')
        .update(
          `${observation.ticker}:SHORT_INTEREST_CHANGE:${settlementDate.toISOString().slice(0, 10)}:${changePercent ?? 'na'}`,
        )
        .digest('hex'),
      evidencePriority: 95,
    };
  }

  private async insiderCandidate(
    processedItemId: string,
    observation: NormalizedObservation,
    candidate: CanonicalEventCandidate,
  ): Promise<CanonicalEventCandidate> {
    const classification = classifyInsiderTransaction(
      observation.normalizedFacts,
    );
    const occurredAt =
      classification.transactionDate ??
      observation.eventAt ??
      observation.publishedAt;
    await this.db.insiderSignal.upsert({
      where: { processedItemId },
      create: {
        processedItemId,
        ticker: observation.ticker!,
        insider: classification.insider,
        role: classification.role,
        transactionType: insiderType(classification.transactionType),
        occurredAt,
        shares: classification.shares,
        price: classification.price,
        transactionValue: classification.transactionValue,
        holdingsBefore: classification.holdingsBefore,
        holdingsAfter: classification.holdingsAfter,
        holdingsChangePercent: classification.holdingsChangePercent,
        planned: classification.planned,
        discretionary: classification.discretionary,
        convictionScore: classification.convictionScore,
        rationale: prismaJson(classification.rationale),
      },
      update: {},
    });
    const recent = await this.db.insiderSignal.findMany({
      where: {
        ticker: observation.ticker!,
        occurredAt: {
          gte: new Date(
            observation.discoveredAt.getTime() - 30 * 24 * 60 * 60_000,
          ),
          lte: observation.discoveredAt,
        },
      },
      select: {
        insider: true,
        transactionType: true,
        occurredAt: true,
      },
    });
    const clusterSize = insiderClusterSize(
      recent.map((entry) => ({
        insider: entry.insider,
        transactionType: coreInsiderType(entry.transactionType),
        occurredAt: entry.occurredAt,
      })),
      observation.discoveredAt,
    );
    await this.db.insiderSignal.update({
      where: { processedItemId },
      data: { clusterSize: Math.max(1, clusterSize) },
    });

    const strongPurchase =
      classification.transactionType === 'OPEN_MARKET_BUY' &&
      classification.convictionScore >= 4;
    const purchaseCluster = clusterSize >= 3;
    const strongSale =
      classification.transactionType === 'OPEN_MARKET_SELL' &&
      classification.convictionScore <= -4;
    const materiality =
      strongPurchase || purchaseCluster
        ? ('HIGH' as const)
        : strongSale
          ? ('MEDIUM' as const)
          : ('LOW' as const);
    const direction =
      classification.convictionScore > 0
        ? ('POSITIVE' as const)
        : classification.convictionScore < 0
          ? ('NEGATIVE' as const)
          : ('NEUTRAL' as const);
    const fingerprint = createHash('sha256')
      .update(
        [
          observation.ticker,
          'INSIDER_TRANSACTION',
          classification.insider.toLowerCase(),
          occurredAt?.toISOString().slice(0, 10) ?? 'unknown-date',
          classification.transactionType,
          classification.shares ?? 'unknown-shares',
          classification.price ?? 'unknown-price',
        ].join(':'),
      )
      .digest('hex');
    return {
      ...candidate,
      occurredAt,
      direction,
      materiality,
      materialityScore:
        materiality === 'HIGH' ? 82 : materiality === 'MEDIUM' ? 58 : 24,
      materialityReasons: [
        ...classification.rationale,
        ...(purchaseCluster
          ? [`${clusterSize} distinct insiders bought within 30 days.`]
          : []),
        'No illegal knowledge or intent is inferred.',
      ],
      action: materiality === 'LOW' ? 'STATE_UPDATE' : 'TARGETED_ANALYSIS',
      magnitude: {
        ...candidate.magnitude,
        insider: classification.insider,
        role: classification.role,
        transactionType: classification.transactionType,
        shares: classification.shares,
        price: classification.price,
        transactionValueUsd: classification.transactionValue,
        holdingsBefore: classification.holdingsBefore,
        holdingsAfter: classification.holdingsAfter,
        holdingsChangePercent: classification.holdingsChangePercent,
        planned: classification.planned,
        discretionary: classification.discretionary,
        convictionScore: classification.convictionScore,
        clusterSize,
      },
      fingerprint,
    };
  }

  private async marketCandidate(
    processedItemId: string,
    observation: NormalizedObservation,
  ): Promise<CanonicalEventCandidate | null> {
    const current = marketPoint(observation);
    if (!current) {
      return null;
    }
    const rows = await this.db.marketSnapshot.findMany({
      where: {
        ticker: observation.ticker!,
        observedAt: { lt: current.at },
      },
      orderBy: { observedAt: 'desc' },
      take: 90,
    });
    const history = rows.reverse().map((row) => ({
      at: row.observedAt,
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume),
    }));
    const anomaly = detectMarketAnomaly(current, history, this.marketPolicy);
    await this.db.marketSnapshot.upsert({
      where: { processedItemId },
      create: {
        processedItemId,
        ticker: observation.ticker!,
        observedAt: current.at,
        open: current.open,
        high: current.high,
        low: current.low,
        close: current.close,
        volume: BigInt(current.volume),
        dailyReturnPercent: anomaly?.dailyReturnPercent ?? null,
        weeklyReturnPercent: anomaly?.weeklyReturnPercent ?? null,
        monthlyReturnPercent: anomaly?.monthlyReturnPercent ?? null,
        ninetyDayReturnPercent: anomaly?.ninetyDayReturnPercent ?? null,
        relativeVolume: anomaly?.relativeVolume ?? null,
        gapPercent: anomaly?.gapPercent ?? null,
        atrPercent: anomaly?.atrPercent ?? null,
        realizedVolatilityPercent: anomaly?.realizedVolatilityPercent ?? null,
        movingAverage20DistancePercent:
          anomaly?.movingAverage20DistancePercent ?? null,
        rsi14: anomaly?.rsi14 ?? null,
        preMarketChangePercent: anomaly?.preMarketChangePercent ?? null,
        afterHoursChangePercent: anomaly?.afterHoursChangePercent ?? null,
        relativeSectorPercent: anomaly?.relativeSectorPercent ?? null,
        relativeIndexPercent: anomaly?.relativeIndexPercent ?? null,
        priceAnomaly: anomaly?.priceAnomaly ?? false,
        volumeAnomaly: anomaly?.volumeAnomaly ?? false,
        gapAnomaly: anomaly?.gapAnomaly ?? false,
        volatilityExpansion: anomaly?.volatilityExpansion ?? false,
        unexplained: anomaly !== null,
      },
      update: {},
    });
    return anomaly ? marketAnomalyEvent(observation, anomaly) : null;
  }

  private async offExchangeCandidate(
    processedItemId: string,
    observation: NormalizedObservation,
  ): Promise<CanonicalEventCandidate | null> {
    const shortVolume = numberValue(observation.normalizedFacts.shortVolume);
    const totalVolume = numberValue(observation.normalizedFacts.totalVolume);
    const dpi = numberValue(observation.normalizedFacts.dpi);
    const observedAt = observation.eventAt ?? observation.publishedAt;
    if (
      shortVolume === null ||
      totalVolume === null ||
      dpi === null ||
      !observedAt ||
      !observation.ticker
    ) {
      return null;
    }
    const history = await this.db.offExchangeSnapshot.findMany({
      where: { ticker: observation.ticker, observedAt: { lt: observedAt } },
      orderBy: { observedAt: 'desc' },
      take: 20,
    });
    const baselineDpi =
      history.length >= 5
        ? history.reduce((total, row) => total + Number(row.dpi), 0) /
          history.length
        : null;
    const relativeDpi =
      baselineDpi && baselineDpi > 0 ? dpi / baselineDpi : null;
    const anomaly = relativeDpi !== null && relativeDpi >= 1.5;
    await this.db.offExchangeSnapshot.upsert({
      where: { processedItemId },
      create: {
        processedItemId,
        ticker: observation.ticker,
        observedAt,
        shortVolume: BigInt(Math.round(shortVolume)),
        totalVolume: BigInt(Math.round(totalVolume)),
        dpi,
        baselineDpi,
        relativeDpi,
        anomaly,
      },
      update: {},
    });
    if (!anomaly) {
      return null;
    }
    const fingerprint = createHash('sha256')
      .update(
        `${observation.ticker}:OFF_EXCHANGE_ANOMALY:${observedAt.toISOString().slice(0, 10)}:${dpi}`,
      )
      .digest('hex');
    return {
      ticker: observation.ticker,
      eventType: 'OFF_EXCHANGE_ANOMALY',
      title: `Unusual off-exchange activity for ${observation.ticker}`,
      occurredAt: observedAt,
      firstPublicAt: observation.publishedAt,
      firstDetectedAt: observation.discoveredAt,
      direction: 'UNKNOWN',
      magnitude: {
        shortVolume,
        totalVolume,
        dpi,
        baselineDpi,
        relativeDpi,
      },
      surprise: 'HIGH',
      materiality: 'MEDIUM',
      materialityScore: 58,
      materialityReasons: [
        'Off-exchange short-volume percentage exceeded its recent baseline.',
        'Activity alone does not establish direction or informed trading.',
      ],
      action: 'STATE_UPDATE',
      fingerprint,
      evidencePriority: 55,
    };
  }

  public async syncEvent(
    eventId: string,
    processedItemId: string,
    observation: NormalizedObservation,
    candidate: CanonicalEventCandidate,
    primaryDriverId: string | null,
  ): Promise<void> {
    if (
      candidate.eventType === 'PRICE_ANOMALY' ||
      candidate.eventType === 'VOLUME_ANOMALY'
    ) {
      await this.db.marketSnapshot.updateMany({
        where: { processedItemId },
        data: {
          primaryDriverId,
          unexplained: primaryDriverId === null,
        },
      });
    } else if (materialityRank(candidate.materiality) >= 2) {
      await this.reconcileUnexplainedReactions(eventId, candidate);
    }
    const catalyst = catalystFromEvent(candidate, observation);
    if (!catalyst) {
      return;
    }
    await this.db.catalyst.upsert({
      where: { fingerprint: catalyst.fingerprint },
      create: {
        eventId,
        fingerprint: catalyst.fingerprint,
        ticker: catalyst.ticker,
        catalystType: catalystType(catalyst.catalystType),
        description: catalyst.description,
        expectedStart: catalyst.expectedStart,
        expectedEnd: catalyst.expectedEnd,
        exactDateKnown: catalyst.exactDateKnown,
        proximity: catalystProximity(catalyst.proximity),
        impact: Materiality[catalyst.impact],
        direction: catalystDirection(catalyst.direction),
        status: catalystStatus(catalyst.status),
      },
      update: {
        eventId,
        description: catalyst.description,
        expectedStart: catalyst.expectedStart,
        expectedEnd: catalyst.expectedEnd,
        exactDateKnown: catalyst.exactDateKnown,
        proximity: catalystProximity(catalyst.proximity),
        impact: Materiality[catalyst.impact],
        direction: catalystDirection(catalyst.direction),
        status: catalystStatus(catalyst.status),
      },
    });
  }

  private async reconcileUnexplainedReactions(
    driverEventId: string,
    driver: CanonicalEventCandidate,
  ): Promise<void> {
    const anchor = driver.occurredAt ?? driver.firstDetectedAt;
    const windowMs = 24 * 60 * 60_000;
    const snapshots = await this.db.marketSnapshot.findMany({
      where: {
        ticker: driver.ticker,
        unexplained: true,
        observedAt: {
          gte: new Date(anchor.getTime() - windowMs),
          lte: new Date(anchor.getTime() + windowMs),
        },
      },
      select: { processedItemId: true },
    });
    if (snapshots.length === 0) return;
    const evidenceIds = snapshots.map(({ processedItemId }) => processedItemId);
    const driverRecord = await this.db.canonicalEvent.findUniqueOrThrow({
      where: { id: driverEventId },
      select: { chainId: true, title: true },
    });
    const reactions = await this.db.canonicalEvent.findMany({
      where: {
        primaryEvidenceId: { in: evidenceIds },
        eventType: { in: ['PRICE_ANOMALY', 'VOLUME_ANOMALY'] },
      },
      select: { id: true, ticker: true, magnitude: true },
    });
    await this.db.marketSnapshot.updateMany({
      where: { processedItemId: { in: evidenceIds } },
      data: { primaryDriverId: driverEventId, unexplained: false },
    });
    await Promise.all(
      reactions.map((reaction) =>
        this.db.canonicalEvent.update({
          where: { id: reaction.id },
          data: {
            primaryDriverId: driverEventId,
            chainId: driverRecord.chainId,
            title: `${reaction.ticker} market reaction after ${driverRecord.title}`,
            magnitude: prismaJson({
              ...jsonObject(reaction.magnitude),
              cause: 'KNOWN_EVENT',
              unexplained: false,
              primaryDriverEventId: driverEventId,
            }),
          },
        }),
      ),
    );
  }
}
