import { percentChange } from './statistics.js';

export type ValidationPricePoint = {
  observedAt: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  ninetyDayReturnPercent?: number | null;
};

export type PriceOutcome = {
  anchorPrice: number | null;
  nextOpenPrice: number | null;
  preDetectionReturnPercent: number | null;
  returnOneHourPercent: number | null;
  returnOneDayPercent: number | null;
  returnSevenDayPercent: number | null;
  returnThirtyDayPercent: number | null;
  returnNinetyDayPercent: number | null;
  returnTwelveMonthPercent: number | null;
  maximumFavorablePercent: number | null;
  maximumAdversePercent: number | null;
  completedHorizons: string[];
  marketRegime: 'BULL' | 'BEAR' | 'NEUTRAL' | 'UNKNOWN';
};

export type OutcomeMetric = {
  sampleSize: number;
  hitRatePercent: number | null;
  averageReturnPercent: number | null;
  medianReturnPercent: number | null;
  averageMaximumFavorablePercent: number | null;
  averageMaximumAdversePercent: number | null;
  worstMaximumAdversePercent: number | null;
};

export type CalibrationBucket = {
  label: string;
  minimum: number;
  maximum: number | null;
  sampleSize: number;
  predictedAveragePercent: number | null;
  realizedHigherPercent: number | null;
  calibrationErrorPoints: number | null;
};

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const MAXIMUM_ANCHOR_STALENESS = 7 * DAY;

const latestAtOrBefore = (
  points: readonly ValidationPricePoint[],
  timestamp: Date,
): ValidationPricePoint | undefined => {
  const time = timestamp.getTime();
  return [...points]
    .filter((point) => {
      const observedAt = point.observedAt.getTime();
      return (
        observedAt <= time && observedAt >= time - MAXIMUM_ANCHOR_STALENESS
      );
    })
    .sort(
      (left, right) => right.observedAt.getTime() - left.observedAt.getTime(),
    )[0];
};

const firstAfter = (
  points: readonly ValidationPricePoint[],
  timestamp: Date,
  maximumDelayMs: number,
): ValidationPricePoint | undefined => {
  const time = timestamp.getTime();
  return [...points]
    .filter((point) => {
      const observedAt = point.observedAt.getTime();
      return observedAt > time && observedAt <= time + maximumDelayMs;
    })
    .sort(
      (left, right) => left.observedAt.getTime() - right.observedAt.getTime(),
    )[0];
};

const pointForHorizon = (
  points: readonly ValidationPricePoint[],
  anchorAt: Date,
  horizonMs: number,
  toleranceMs: number,
): ValidationPricePoint | undefined => {
  const target = anchorAt.getTime() + horizonMs;
  const earlyTolerance = Math.min(12 * HOUR, horizonMs / 4);
  return [...points]
    .filter((point) => {
      const time = point.observedAt.getTime();
      return time >= target - earlyTolerance && time <= target + toleranceMs;
    })
    .sort(
      (left, right) => left.observedAt.getTime() - right.observedAt.getTime(),
    )[0];
};

const classifyMarketRegime = (
  ninetyDayReturnPercent: number | null | undefined,
): PriceOutcome['marketRegime'] => {
  if (ninetyDayReturnPercent === null || ninetyDayReturnPercent === undefined) {
    return 'UNKNOWN';
  }
  if (ninetyDayReturnPercent >= 10) return 'BULL';
  if (ninetyDayReturnPercent <= -10) return 'BEAR';
  return 'NEUTRAL';
};

export const calculatePriceOutcome = (
  anchorAt: Date,
  points: readonly ValidationPricePoint[],
): PriceOutcome => {
  const ordered = [...points].sort(
    (left, right) => left.observedAt.getTime() - right.observedAt.getTime(),
  );
  const anchor = latestAtOrBefore(ordered, anchorAt);
  if (!anchor) {
    return {
      anchorPrice: null,
      nextOpenPrice: null,
      preDetectionReturnPercent: null,
      returnOneHourPercent: null,
      returnOneDayPercent: null,
      returnSevenDayPercent: null,
      returnThirtyDayPercent: null,
      returnNinetyDayPercent: null,
      returnTwelveMonthPercent: null,
      maximumFavorablePercent: null,
      maximumAdversePercent: null,
      completedHorizons: [],
      marketRegime: 'UNKNOWN',
    };
  }

  const anchorIndex = ordered.indexOf(anchor);
  const prior = anchorIndex > 0 ? ordered[anchorIndex - 1] : undefined;
  const next = firstAfter(ordered, anchorAt, 7 * DAY);
  const horizons = [
    ['ONE_HOUR', 'returnOneHourPercent', HOUR, HOUR],
    ['ONE_DAY', 'returnOneDayPercent', DAY, 3 * DAY],
    ['SEVEN_DAYS', 'returnSevenDayPercent', 7 * DAY, 4 * DAY],
    ['THIRTY_DAYS', 'returnThirtyDayPercent', 30 * DAY, 7 * DAY],
    ['NINETY_DAYS', 'returnNinetyDayPercent', 90 * DAY, 14 * DAY],
    ['TWELVE_MONTHS', 'returnTwelveMonthPercent', 365 * DAY, 30 * DAY],
  ] as const;
  const returns: Partial<Record<(typeof horizons)[number][1], number | null>> =
    {};
  const completedHorizons: string[] = [];
  for (const [label, key, duration, tolerance] of horizons) {
    const point = pointForHorizon(ordered, anchorAt, duration, tolerance);
    returns[key] = point ? percentChange(point.close, anchor.close) : null;
    if (point) completedHorizons.push(label);
  }

  const excursionWindow = ordered.filter((point) => {
    const time = point.observedAt.getTime();
    return time > anchorAt.getTime() && time <= anchorAt.getTime() + 365 * DAY;
  });
  const favorable = excursionWindow
    .map((point) => percentChange(point.high, anchor.close))
    .filter((value): value is number => value !== null);
  const adverse = excursionWindow
    .map((point) => percentChange(point.low, anchor.close))
    .filter((value): value is number => value !== null);

  return {
    anchorPrice: anchor.close,
    nextOpenPrice: next?.open ?? null,
    preDetectionReturnPercent: prior
      ? percentChange(anchor.close, prior.close)
      : null,
    returnOneHourPercent: returns.returnOneHourPercent ?? null,
    returnOneDayPercent: returns.returnOneDayPercent ?? null,
    returnSevenDayPercent: returns.returnSevenDayPercent ?? null,
    returnThirtyDayPercent: returns.returnThirtyDayPercent ?? null,
    returnNinetyDayPercent: returns.returnNinetyDayPercent ?? null,
    returnTwelveMonthPercent: returns.returnTwelveMonthPercent ?? null,
    maximumFavorablePercent: favorable.length ? Math.max(...favorable) : null,
    maximumAdversePercent: adverse.length ? Math.min(...adverse) : null,
    completedHorizons,
    marketRegime: classifyMarketRegime(anchor.ninetyDayReturnPercent),
  };
};

const mean = (values: readonly number[]): number | null =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;

const median = (values: readonly number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

export const summarizeOutcomes = (
  outcomes: readonly {
    returnPercent: number | null;
    maximumFavorablePercent: number | null;
    maximumAdversePercent: number | null;
  }[],
): OutcomeMetric => {
  const returns = outcomes
    .map((outcome) => outcome.returnPercent)
    .filter((value): value is number => value !== null);
  const favorable = outcomes
    .map((outcome) => outcome.maximumFavorablePercent)
    .filter((value): value is number => value !== null);
  const adverse = outcomes
    .map((outcome) => outcome.maximumAdversePercent)
    .filter((value): value is number => value !== null);
  return {
    sampleSize: returns.length,
    hitRatePercent: returns.length
      ? (returns.filter((value) => value > 0).length / returns.length) * 100
      : null,
    averageReturnPercent: mean(returns),
    medianReturnPercent: median(returns),
    averageMaximumFavorablePercent: mean(favorable),
    averageMaximumAdversePercent: mean(adverse),
    worstMaximumAdversePercent: adverse.length ? Math.min(...adverse) : null,
  };
};

const calibrationRanges = [
  { label: '50–55%', minimum: 50, maximum: 55 },
  { label: '55–60%', minimum: 55, maximum: 60 },
  { label: '60–65%', minimum: 60, maximum: 65 },
  { label: '65–70%', minimum: 65, maximum: 70 },
  { label: '70–80%', minimum: 70, maximum: 80 },
  { label: '80%+', minimum: 80, maximum: null },
] as const;

export const calculateCalibration = (
  outcomes: readonly {
    predictedPercent: number | null;
    returnPercent: number | null;
  }[],
): CalibrationBucket[] =>
  calibrationRanges.map((range) => {
    const entries = outcomes.filter(
      (
        outcome,
      ): outcome is { predictedPercent: number; returnPercent: number } =>
        outcome.predictedPercent !== null &&
        outcome.returnPercent !== null &&
        outcome.predictedPercent >= range.minimum &&
        (range.maximum === null || outcome.predictedPercent < range.maximum),
    );
    const predictedAveragePercent = mean(
      entries.map((entry) => entry.predictedPercent),
    );
    const realizedHigherPercent = entries.length
      ? (entries.filter((entry) => entry.returnPercent > 0).length /
          entries.length) *
        100
      : null;
    return {
      ...range,
      sampleSize: entries.length,
      predictedAveragePercent,
      realizedHigherPercent,
      calibrationErrorPoints:
        predictedAveragePercent === null || realizedHigherPercent === null
          ? null
          : realizedHigherPercent - predictedAveragePercent,
    };
  });

export const probabilityMidpoint = (
  range: { minimum: number; maximum: number } | null | undefined,
): number | null => (range ? (range.minimum + range.maximum) / 2 : null);
