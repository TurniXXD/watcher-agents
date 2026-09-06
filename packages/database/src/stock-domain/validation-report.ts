import { nullableNumber } from '../utils/json.js';
import { average } from './statistics.js';
import { summarizeOutcomes, type OutcomeMetric } from './validation.js';

export type GroupMetric = { group: string; metric: OutcomeMetric };

export type BacktestSummary = {
  generatedAt: Date;
  targetCount: number;
  horizons: {
    oneHour: OutcomeMetric;
    oneDay: OutcomeMetric;
    sevenDays: OutcomeMetric;
    thirtyDays: OutcomeMetric;
    ninetyDays: OutcomeMetric;
    twelveMonths: OutcomeMetric;
  };
  alertTiming: {
    sampleSize: number;
    averagePreDetectionReturnPercent: number | null;
    averageDetectionToNextOpenPercent: number | null;
  };
  breakdowns: {
    verdict: GroupMetric[];
    sector: GroupMetric[];
    catalyst: GroupMetric[];
    signalType: GroupMetric[];
    signalCombination: GroupMetric[];
    confidence: GroupMetric[];
    attention: GroupMetric[];
    marketRegime: GroupMetric[];
  };
};

export type SignalPerformance = GroupMetric & { sufficientSample: boolean };

export type ValidationOutcomeRecord = {
  targetType: string;
  verdict: string | null;
  sector: string | null;
  catalyst: string | null;
  signalType: string | null;
  signalCombination: unknown;
  confidence: number | null;
  attention: number | null;
  marketRegime: string | null;
  anchorPrice: unknown;
  nextOpenPrice: unknown;
  preDetectionReturnPercent: unknown;
  returnOneHourPercent: unknown;
  returnOneDayPercent: unknown;
  returnSevenDayPercent: unknown;
  returnThirtyDayPercent: unknown;
  returnNinetyDayPercent: unknown;
  returnTwelveMonthPercent: unknown;
  maximumFavorablePercent: unknown;
  maximumAdversePercent: unknown;
  predictedThirtyDayProbability: number | null;
};

type OutcomeNumberKey =
  | 'anchorPrice'
  | 'nextOpenPrice'
  | 'preDetectionReturnPercent'
  | 'returnOneHourPercent'
  | 'returnOneDayPercent'
  | 'returnSevenDayPercent'
  | 'returnThirtyDayPercent'
  | 'returnNinetyDayPercent'
  | 'returnTwelveMonthPercent'
  | 'maximumFavorablePercent'
  | 'maximumAdversePercent';

type NormalizedOutcome = Omit<ValidationOutcomeRecord, OutcomeNumberKey> &
  Record<OutcomeNumberKey, number | null>;

export const normalizeValidationOutcome = (
  outcome: ValidationOutcomeRecord,
): NormalizedOutcome => ({
  ...outcome,
  anchorPrice: nullableNumber(outcome.anchorPrice),
  nextOpenPrice: nullableNumber(outcome.nextOpenPrice),
  preDetectionReturnPercent: nullableNumber(outcome.preDetectionReturnPercent),
  returnOneHourPercent: nullableNumber(outcome.returnOneHourPercent),
  returnOneDayPercent: nullableNumber(outcome.returnOneDayPercent),
  returnSevenDayPercent: nullableNumber(outcome.returnSevenDayPercent),
  returnThirtyDayPercent: nullableNumber(outcome.returnThirtyDayPercent),
  returnNinetyDayPercent: nullableNumber(outcome.returnNinetyDayPercent),
  returnTwelveMonthPercent: nullableNumber(outcome.returnTwelveMonthPercent),
  maximumFavorablePercent: nullableNumber(outcome.maximumFavorablePercent),
  maximumAdversePercent: nullableNumber(outcome.maximumAdversePercent),
});

const groupOutcomes = (
  outcomes: readonly NormalizedOutcome[],
  selector: (outcome: NormalizedOutcome) => string | null,
): GroupMetric[] => {
  const groups = new Map<string, NormalizedOutcome[]>();
  for (const outcome of outcomes) {
    const group = selector(outcome);
    if (!group) continue;
    groups.set(group, [...(groups.get(group) ?? []), outcome]);
  }
  return [...groups.entries()]
    .map(([group, entries]) => ({
      group,
      metric: summarizeOutcomes(
        entries.map((entry) => ({
          returnPercent: entry.returnThirtyDayPercent,
          maximumFavorablePercent: entry.maximumFavorablePercent,
          maximumAdversePercent: entry.maximumAdversePercent,
        })),
      ),
    }))
    .sort((left, right) => right.metric.sampleSize - left.metric.sampleSize);
};

export const buildBacktestSummary = (
  raw: readonly ValidationOutcomeRecord[],
  alertTargetType = 'ALERT',
): BacktestSummary => {
  const outcomes = raw.map(normalizeValidationOutcome);
  const metric = (
    key:
      | 'returnOneHourPercent'
      | 'returnOneDayPercent'
      | 'returnSevenDayPercent'
      | 'returnThirtyDayPercent'
      | 'returnNinetyDayPercent'
      | 'returnTwelveMonthPercent',
  ) =>
    summarizeOutcomes(
      outcomes.map((outcome) => ({
        returnPercent: outcome[key],
        maximumFavorablePercent: outcome.maximumFavorablePercent,
        maximumAdversePercent: outcome.maximumAdversePercent,
      })),
    );
  const alerts = outcomes.filter(
    (outcome) => outcome.targetType === alertTargetType,
  );
  return {
    generatedAt: new Date(),
    targetCount: outcomes.length,
    horizons: {
      oneHour: metric('returnOneHourPercent'),
      oneDay: metric('returnOneDayPercent'),
      sevenDays: metric('returnSevenDayPercent'),
      thirtyDays: metric('returnThirtyDayPercent'),
      ninetyDays: metric('returnNinetyDayPercent'),
      twelveMonths: metric('returnTwelveMonthPercent'),
    },
    alertTiming: {
      sampleSize: alerts.length,
      averagePreDetectionReturnPercent: average(
        alerts.map((alert) => alert.preDetectionReturnPercent),
      ),
      averageDetectionToNextOpenPercent: average(
        alerts.map((alert) =>
          alert.anchorPrice && alert.nextOpenPrice
            ? ((alert.nextOpenPrice - alert.anchorPrice) / alert.anchorPrice) *
              100
            : null,
        ),
      ),
    },
    breakdowns: {
      verdict: groupOutcomes(outcomes, (outcome) => outcome.verdict),
      sector: groupOutcomes(outcomes, (outcome) => outcome.sector),
      catalyst: groupOutcomes(outcomes, (outcome) => outcome.catalyst),
      signalType: groupOutcomes(outcomes, (outcome) => outcome.signalType),
      signalCombination: groupOutcomes(outcomes, (outcome) =>
        Array.isArray(outcome.signalCombination)
          ? outcome.signalCombination
              .filter((value) => typeof value === 'string')
              .join(' + ') || null
          : null,
      ),
      confidence: groupOutcomes(outcomes, (outcome) =>
        outcome.confidence === null
          ? null
          : `${Math.floor(outcome.confidence * 10) * 10}–${Math.floor(outcome.confidence * 10) * 10 + 10}%`,
      ),
      attention: groupOutcomes(outcomes, (outcome) =>
        outcome.attention === null
          ? null
          : `${Math.floor(outcome.attention / 20) * 20}–${Math.min(100, Math.floor(outcome.attention / 20) * 20 + 19)}`,
      ),
      marketRegime: groupOutcomes(outcomes, (outcome) => outcome.marketRegime),
    },
  };
};

export const buildSignalPerformance = (
  raw: readonly ValidationOutcomeRecord[],
  minimumSampleSize: number,
): SignalPerformance[] =>
  groupOutcomes(
    raw.map(normalizeValidationOutcome),
    (outcome) => outcome.signalType,
  ).map((entry) => ({
    ...entry,
    sufficientSample: entry.metric.sampleSize >= minimumSampleSize,
  }));
