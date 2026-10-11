import { createHash } from 'node:crypto';
import { errorMessage, finiteNumber } from '@watcher/core';
import type { DiscoveryCandidate } from './core/index.js';
import type { NasdaqPriceSource } from './sources/price.js';
import type { ZacksSource } from './sources/zacks.js';

export type DiscoveryScreeningPolicy = {
  oversoldRsiThreshold: number;
  maximumForwardPe: number;
};

export type DiscoveryScreeningAssessment = {
  signals: Array<'OVERSOLD' | 'UNDERVALUED'>;
  primaryTrigger: 'OVERSOLD' | 'UNDERVALUED' | null;
  rsi14: number | null;
  forwardPe: number | null;
  analystRank: number | null;
  attentionScore: number;
  reason: string | null;
  sourceFailures: string[];
};

export const calculateRsi14 = (closes: readonly number[]): number | null => {
  const window = closes.slice(-15);
  if (window.length < 15 || window.some((value) => value <= 0)) return null;
  const changes = window.slice(1).map((value, index) => value - window[index]!);
  const averageGain =
    changes.reduce((sum, value) => sum + Math.max(0, value), 0) / 14;
  const averageLoss =
    changes.reduce((sum, value) => sum + Math.max(0, -value), 0) / 14;
  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  const value = 100 - 100 / (1 + averageGain / averageLoss);
  return Number(value.toFixed(2));
};

export const assessDiscoveryScreening = (
  input: {
    closes: readonly number[];
    forwardPe: string | number | null;
    analystRank: string | number | null;
    analystRankText: string | null;
  },
  policy: DiscoveryScreeningPolicy,
): DiscoveryScreeningAssessment => {
  const rsi14 = calculateRsi14(input.closes);
  const forwardPe = finiteNumber(input.forwardPe);
  const analystRank = finiteNumber(input.analystRank);
  const oversold = rsi14 !== null && rsi14 <= policy.oversoldRsiThreshold;
  const undervalued =
    forwardPe !== null &&
    forwardPe > 0 &&
    forwardPe <= policy.maximumForwardPe &&
    analystRank !== null &&
    analystRank <= 2;
  const signals: DiscoveryScreeningAssessment['signals'] = [
    ...(oversold ? (['OVERSOLD'] as const) : []),
    ...(undervalued ? (['UNDERVALUED'] as const) : []),
  ];
  const primaryTrigger = oversold
    ? 'OVERSOLD'
    : undervalued
      ? 'UNDERVALUED'
      : null;
  if (!primaryTrigger) {
    return {
      signals,
      primaryTrigger,
      rsi14,
      forwardPe,
      analystRank,
      attentionScore: 0,
      reason: null,
      sourceFailures: [],
    };
  }
  const oversoldScore = oversold
    ? Math.min(92, 70 + Math.round((policy.oversoldRsiThreshold - rsi14) * 1.5))
    : 0;
  const valueScore = undervalued
    ? Math.min(
        92,
        72 +
          (analystRank === 1 ? 8 : 4) +
          Math.round(
            ((policy.maximumForwardPe - forwardPe) / policy.maximumForwardPe) *
              12,
          ),
      )
    : 0;
  const reason = [
    oversold
      ? `Oversold screen: daily RSI(14) ${rsi14.toFixed(2)} ≤ ${policy.oversoldRsiThreshold}.`
      : undefined,
    undervalued
      ? `Potential value screen: forward P/E ${forwardPe.toFixed(2)} ≤ ${policy.maximumForwardPe} with analyst rank ${analystRank}${input.analystRankText ? ` (${input.analystRankText})` : ''}.`
      : undefined,
    'Screening heuristic only; verify fundamentals, data freshness, sector comparables, and downside risk.',
  ]
    .filter((part): part is string => Boolean(part))
    .join(' ');
  return {
    signals,
    primaryTrigger,
    rsi14,
    forwardPe,
    analystRank,
    attentionScore: Math.min(
      95,
      Math.max(oversoldScore, valueScore) + (signals.length > 1 ? 3 : 0),
    ),
    reason,
    sourceFailures: [],
  };
};

export const screenedDiscoveryCandidate = (
  candidate: DiscoveryCandidate,
  assessment: DiscoveryScreeningAssessment,
): DiscoveryCandidate | null => {
  if (!assessment.primaryTrigger || !assessment.reason) return null;
  const fingerprint = createHash('sha256')
    .update(
      [
        candidate.fingerprint,
        assessment.signals.join(','),
        assessment.rsi14?.toFixed(4) ?? '',
        assessment.forwardPe?.toFixed(4) ?? '',
        assessment.analystRank ?? '',
      ].join(':'),
    )
    .digest('hex');
  return {
    ...candidate,
    screeningSignals: assessment.signals,
    attentionScore: assessment.attentionScore,
    reason: assessment.reason,
    fingerprint,
  };
};

export class DiscoveryScreeningClient {
  public constructor(
    private readonly prices: Pick<NasdaqPriceSource, 'getDailyHistory'>,
    private readonly zacks: Pick<ZacksSource, 'getSnapshot'>,
    private readonly policy: DiscoveryScreeningPolicy,
  ) {}

  public async assess(
    ticker: string,
    signal?: AbortSignal,
  ): Promise<DiscoveryScreeningAssessment> {
    const [historyResult, valuationResult] = await Promise.allSettled([
      this.prices.getDailyHistory(ticker, 120, 100, signal),
      this.zacks.getSnapshot(ticker, signal),
    ]);
    if (signal?.aborted) throw signal.reason;
    const history =
      historyResult.status === 'fulfilled' ? historyResult.value : [];
    const valuation =
      valuationResult.status === 'fulfilled' ? valuationResult.value : null;
    const assessment = assessDiscoveryScreening(
      {
        closes: history.map(({ close }) => close),
        forwardPe: valuation?.forwardPe ?? null,
        analystRank: valuation?.rank ?? null,
        analystRankText: valuation?.rankText ?? null,
      },
      this.policy,
    );
    return {
      ...assessment,
      sourceFailures: [
        ...(historyResult.status === 'rejected'
          ? [`Nasdaq history: ${errorMessage(historyResult.reason)}`]
          : []),
        ...(valuationResult.status === 'rejected'
          ? [`Zacks valuation: ${errorMessage(valuationResult.reason)}`]
          : []),
      ],
    };
  }
}
