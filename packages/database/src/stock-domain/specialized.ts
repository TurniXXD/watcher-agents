import { createHash } from 'node:crypto';
import { parseDate, type NormalizedObservation } from '@watcher/core';
import type {
  CanonicalEventCandidate,
  CanonicalEventType,
  Materiality,
} from './intelligence.js';
import { booleanFact, numberFact, stringFact } from './facts.js';
import { average, percentChange } from './statistics.js';

export type InsiderTransactionType =
  | 'OPEN_MARKET_BUY'
  | 'OPEN_MARKET_SELL'
  | '10B5_1_SALE'
  | 'TAX_SELL_TO_COVER'
  | 'OPTION_EXERCISE'
  | 'RSU_VESTING'
  | 'GIFT'
  | 'OTHER';

export type InsiderClassification = {
  insider: string;
  role: string | null;
  transactionType: InsiderTransactionType;
  transactionDate: Date | null;
  shares: number | null;
  price: number | null;
  transactionValue: number | null;
  holdingsBefore: number | null;
  holdingsAfter: number | null;
  holdingsChangePercent: number | null;
  planned: boolean;
  discretionary: boolean;
  convictionScore: number;
  rationale: string[];
};

const boundedConviction = (value: number): number =>
  Math.max(-5, Math.min(5, Math.round(value)));

export const classifyInsiderTransaction = (
  facts: Record<string, unknown>,
): InsiderClassification => {
  const transactionCode =
    stringFact(facts, 'transactionCode', 'code')?.toUpperCase() ?? '';
  const transactionText =
    stringFact(facts, 'transaction', 'transactionType')?.toUpperCase() ?? '';
  const acquiredDisposed =
    stringFact(
      facts,
      'acquiredDisposedCode',
      'acquiredDisposed',
    )?.toUpperCase() ?? '';
  const footnotes = stringFact(facts, 'footnotes', 'remarks') ?? '';
  const planned =
    booleanFact(facts, 'planned', 'is10b51') ?? /10B5[- ]?1/i.test(footnotes);
  let transactionType: InsiderTransactionType = 'OTHER';
  if (transactionCode === 'P' || /PURCHASE|BUY/.test(transactionText)) {
    transactionType = 'OPEN_MARKET_BUY';
  } else if (
    transactionCode === 'S' ||
    /OPEN MARKET SALE|SELL|SALE/.test(transactionText)
  ) {
    transactionType = planned ? '10B5_1_SALE' : 'OPEN_MARKET_SELL';
  } else if (transactionCode === 'F' || /TAX|WITHHOLD/.test(transactionText)) {
    transactionType = 'TAX_SELL_TO_COVER';
  } else if (
    transactionCode === 'M' ||
    /OPTION EXERCISE/.test(transactionText)
  ) {
    transactionType = 'OPTION_EXERCISE';
  } else if (
    transactionCode === 'A' ||
    /RSU|RESTRICTED STOCK|VEST/.test(transactionText)
  ) {
    transactionType = 'RSU_VESTING';
  } else if (transactionCode === 'G' || /GIFT/.test(transactionText)) {
    transactionType = 'GIFT';
  }

  const insider =
    stringFact(facts, 'owner', 'insider', 'name') ?? 'Unknown insider';
  const role = stringFact(facts, 'role', 'relationship', 'officerTitle');
  const shares = numberFact(facts, 'shares', 'transactionShares');
  const price = numberFact(facts, 'price', 'cost', 'pricePerShare');
  const holdingsAfter = numberFact(
    facts,
    'holdingsAfter',
    'sharesTotal',
    'sharesOwnedFollowing',
  );
  const transactionValue =
    numberFact(facts, 'transactionValue', 'value') ??
    (shares !== null && price !== null ? shares * price : null);
  const holdingsBefore =
    holdingsAfter === null || shares === null
      ? null
      : acquiredDisposed === 'A' || transactionType === 'OPEN_MARKET_BUY'
        ? Math.max(0, holdingsAfter - shares)
        : holdingsAfter + shares;
  const holdingsDelta =
    shares === null
      ? null
      : acquiredDisposed === 'A' || transactionType === 'OPEN_MARKET_BUY'
        ? shares
        : -shares;
  const holdingsChangePercent =
    holdingsDelta !== null && holdingsBefore !== null && holdingsBefore > 0
      ? (holdingsDelta / holdingsBefore) * 100
      : null;
  const executive = /\b(CEO|CFO|CHIEF EXECUTIVE|CHIEF FINANCIAL)\b/i.test(
    role ?? '',
  );
  const rationale: string[] = [];
  let convictionScore = 0;

  if (transactionType === 'OPEN_MARKET_BUY') {
    convictionScore = 2;
    rationale.push('Discretionary open-market purchase.');
    if (executive) {
      convictionScore += 1;
      rationale.push('Transaction was reported by a CEO or CFO.');
    }
    if ((transactionValue ?? 0) >= 1_000_000) {
      convictionScore += 1;
      rationale.push('Reported transaction value is at least $1 million.');
    }
    if ((holdingsChangePercent ?? 0) >= 5) {
      convictionScore += 1;
      rationale.push('Purchase increased reported holdings by at least 5%.');
    }
  } else if (transactionType === 'OPEN_MARKET_SELL') {
    convictionScore = -1;
    rationale.push('Discretionary open-market sale.');
    if (executive) {
      convictionScore -= 1;
    }
    if ((transactionValue ?? 0) >= 1_000_000) {
      convictionScore -= 1;
    }
    if (Math.abs(holdingsChangePercent ?? 0) >= 10) {
      convictionScore -= 1;
    }
  } else if (transactionType === '10B5_1_SALE') {
    convictionScore = -1;
    rationale.push('Sale was identified as planned under Rule 10b5-1.');
  } else {
    rationale.push(
      'Administrative, compensatory, tax-related, gifted, or unclassified transaction.',
    );
  }

  return {
    insider,
    role,
    transactionType,
    transactionDate:
      parseDate(stringFact(facts, 'transactionDate', 'date')) ?? null,
    shares,
    price,
    transactionValue,
    holdingsBefore,
    holdingsAfter,
    holdingsChangePercent,
    planned,
    discretionary:
      transactionType === 'OPEN_MARKET_BUY' ||
      transactionType === 'OPEN_MARKET_SELL',
    convictionScore: boundedConviction(convictionScore),
    rationale,
  };
};

export const insiderClusterSize = (
  transactions: Array<{
    insider: string;
    transactionType: InsiderTransactionType;
    occurredAt: Date | null;
  }>,
  now: Date,
  windowDays = 30,
): number => {
  const after = now.getTime() - windowDays * 24 * 60 * 60_000;
  return new Set(
    transactions
      .filter(
        (transaction) =>
          transaction.transactionType === 'OPEN_MARKET_BUY' &&
          transaction.occurredAt !== null &&
          transaction.occurredAt.getTime() >= after &&
          transaction.occurredAt <= now,
      )
      .map(({ insider }) => insider.trim().toLowerCase()),
  ).size;
};

export type MarketPricePoint = {
  at: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  preMarketPrice?: number | null;
  afterHoursPrice?: number | null;
  sectorReturnPercent?: number | null;
  indexReturnPercent?: number | null;
};

export type MarketAnomalyPolicy = {
  priceMovePercent: number;
  gapPercent: number;
  relativeVolume: number;
  volatilityExpansion: number;
  minimumVolumeBaseline: number;
};

export const defaultMarketAnomalyPolicy: MarketAnomalyPolicy = {
  priceMovePercent: 4,
  gapPercent: 3,
  relativeVolume: 3,
  volatilityExpansion: 2,
  minimumVolumeBaseline: 5,
};

export type MarketAnomaly = {
  dailyReturnPercent: number;
  weeklyReturnPercent: number | null;
  monthlyReturnPercent: number | null;
  ninetyDayReturnPercent: number | null;
  relativeVolume: number | null;
  returnVolatilityRatio: number | null;
  gapPercent: number;
  atrPercent: number | null;
  realizedVolatilityPercent: number | null;
  movingAverage20DistancePercent: number | null;
  rsi14: number | null;
  preMarketChangePercent: number | null;
  afterHoursChangePercent: number | null;
  relativeSectorPercent: number | null;
  relativeIndexPercent: number | null;
  priceAnomaly: boolean;
  volumeAnomaly: boolean;
  gapAnomaly: boolean;
  volatilityExpansion: boolean;
};

const standardDeviation = (values: number[]): number | null => {
  const mean = average(values);
  if (mean === null || values.length < 2) {
    return null;
  }
  return Math.sqrt(
    values.reduce((total, value) => total + (value - mean) ** 2, 0) /
      (values.length - 1),
  );
};

const returnAt = (
  current: MarketPricePoint,
  history: MarketPricePoint[],
  sessions: number,
): number | null => {
  const point = history.at(-sessions);
  return point ? percentChange(current.close, point.close) : null;
};

export const detectMarketAnomaly = (
  current: MarketPricePoint,
  history: MarketPricePoint[],
  policy: MarketAnomalyPolicy = defaultMarketAnomalyPolicy,
): MarketAnomaly | null => {
  const previous = history.at(-1);
  if (!previous || previous.close <= 0) {
    return null;
  }
  const dailyReturnPercent = percentChange(current.close, previous.close) ?? 0;
  const gapPercent = percentChange(current.open, previous.close) ?? 0;
  const baseline = history.slice(-20);
  const sortedVolumes = baseline
    .map(({ volume }) => volume)
    .sort((left, right) => left - right);
  const middle = Math.floor(sortedVolumes.length / 2);
  const medianVolume =
    baseline.length >= policy.minimumVolumeBaseline
      ? sortedVolumes.length % 2 === 0
        ? (sortedVolumes[middle - 1]! + sortedVolumes[middle]!) / 2
        : sortedVolumes[middle]!
      : null;
  const relativeVolume =
    medianVolume && medianVolume > 0 ? current.volume / medianVolume : null;
  const closes = [...baseline.map(({ close }) => close), current.close];
  const returns = closes
    .slice(1)
    .map((close, index) => close / closes[index]! - 1);
  const realizedVolatility = standardDeviation(returns);
  const historicalRanges = baseline.map(({ high, low, close }, index) => {
    const priorClose = baseline[index - 1]?.close ?? close;
    return Math.max(
      high - low,
      Math.abs(high - priorClose),
      Math.abs(low - priorClose),
    );
  });
  const atr = average(historicalRanges.slice(-14));
  const movingAverage20 = average(baseline.map(({ close }) => close));
  const recentReturns = returns.slice(-14);
  const gains = average(recentReturns.map((value) => Math.max(0, value)));
  const losses = average(recentReturns.map((value) => Math.max(0, -value)));
  const rsi14 =
    gains === null || losses === null
      ? null
      : losses === 0
        ? 100
        : 100 - 100 / (1 + gains / losses);
  const historicalVolatility = standardDeviation(returns.slice(0, -1));
  const currentAbsoluteReturn = Math.abs(returns.at(-1) ?? 0);
  const returnVolatilityRatio =
    historicalVolatility !== null && historicalVolatility > 0
      ? currentAbsoluteReturn / historicalVolatility
      : null;
  const volatilityExpansion =
    returnVolatilityRatio !== null &&
    returnVolatilityRatio >= policy.volatilityExpansion;
  const priceAnomaly = Math.abs(dailyReturnPercent) >= policy.priceMovePercent;
  const gapAnomaly = Math.abs(gapPercent) >= policy.gapPercent;
  const volumeAnomaly =
    relativeVolume !== null && relativeVolume >= policy.relativeVolume;

  if (!priceAnomaly && !gapAnomaly && !volumeAnomaly && !volatilityExpansion) {
    return null;
  }
  return {
    dailyReturnPercent,
    weeklyReturnPercent: returnAt(current, history, 5),
    monthlyReturnPercent: returnAt(current, history, 21),
    ninetyDayReturnPercent: returnAt(current, history, 63),
    relativeVolume,
    returnVolatilityRatio,
    gapPercent,
    atrPercent: atr === null ? null : (atr / current.close) * 100,
    realizedVolatilityPercent:
      realizedVolatility === null
        ? null
        : realizedVolatility * Math.sqrt(252) * 100,
    movingAverage20DistancePercent:
      movingAverage20 === null
        ? null
        : percentChange(current.close, movingAverage20),
    rsi14,
    preMarketChangePercent:
      current.preMarketPrice && previous.close > 0
        ? percentChange(current.preMarketPrice, previous.close)
        : null,
    afterHoursChangePercent:
      current.afterHoursPrice && current.close > 0
        ? percentChange(current.afterHoursPrice, current.close)
        : null,
    relativeSectorPercent:
      current.sectorReturnPercent == null
        ? null
        : dailyReturnPercent - current.sectorReturnPercent,
    relativeIndexPercent:
      current.indexReturnPercent == null
        ? null
        : dailyReturnPercent - current.indexReturnPercent,
    priceAnomaly,
    volumeAnomaly,
    gapAnomaly,
    volatilityExpansion,
  };
};

export const marketAnomalyEvent = (
  observation: NormalizedObservation,
  anomaly: MarketAnomaly,
): CanonicalEventCandidate => {
  if (!observation.ticker) {
    throw new Error('Market anomaly requires a ticker');
  }
  const eventType: CanonicalEventType =
    anomaly.priceAnomaly || anomaly.gapAnomaly
      ? 'PRICE_ANOMALY'
      : 'VOLUME_ANOMALY';
  const move = Math.abs(anomaly.dailyReturnPercent);
  const materiality: Materiality =
    move >= 8 || (anomaly.relativeVolume ?? 0) >= 5 ? 'HIGH' : 'MEDIUM';
  const occurredAt = observation.eventAt ?? observation.publishedAt;
  const fingerprint = createHash('sha256')
    .update(
      [
        observation.ticker,
        eventType,
        occurredAt?.toISOString().slice(0, 16) ?? 'unknown',
        anomaly.dailyReturnPercent.toFixed(4),
        anomaly.relativeVolume?.toFixed(4) ?? 'unknown-volume',
      ].join(':'),
    )
    .digest('hex');
  return {
    ticker: observation.ticker,
    eventType,
    eventTypes: [eventType, 'PRICE_MOVE'],
    title: `Unexplained ${observation.ticker} ${eventType === 'PRICE_ANOMALY' ? 'price' : 'volume'} anomaly`,
    occurredAt,
    firstPublicAt: observation.publishedAt,
    firstDetectedAt: observation.discoveredAt,
    direction: 'UNKNOWN',
    magnitude: { ...anomaly, cause: 'UNKNOWN', unexplained: true },
    surprise: 'HIGH',
    materiality,
    materialityScore: materiality === 'HIGH' ? 80 : 62,
    materialityReasons: [
      'Price/volume behavior exceeded the configured historical baseline.',
      'No direction or information leak is inferred from market activity alone.',
    ],
    action: 'STATE_UPDATE',
    fingerprint,
    evidencePriority: 45,
  };
};
