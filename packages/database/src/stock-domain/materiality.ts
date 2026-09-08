import type {
  CanonicalEventType,
  EventAction,
  Materiality,
} from './intelligence.js';

export type MaterialityMarketContext = {
  dailyReturnPercent?: number | null;
  returnVolatilityRatio?: number | null;
  relativeVolume?: number | null;
  gapPercent?: number | null;
};

export type MaterialityGateInput = {
  initialMateriality: Materiality;
  initialScore: number;
  initialReasons?: readonly string[];
  eventTypes: readonly CanonicalEventType[];
  market?: MaterialityMarketContext | null;
  independentSourceCount?: number;
};

export type MaterialityDecision = {
  shouldAnalyze: boolean;
  materiality: Materiality;
  action: EventAction;
  score: number;
  reasons: string[];
  marketAnomalyTriggered: boolean;
};

const rank = (value: Materiality): number =>
  ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'EXTREME'].indexOf(value);

const strategicTypes = new Set<CanonicalEventType>([
  'EARNINGS',
  'GUIDANCE',
  'ACQUISITION',
  'MERGER',
  'FDA_DECISION',
]);

const finiteMagnitude = (value: number | null | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.abs(value) : 0;

/**
 * Deterministic, re-evaluatable gate applied after event classification and
 * market enrichment. It is deliberately independent from headline labels.
 */
export const evaluateMateriality = (
  input: MaterialityGateInput,
): MaterialityDecision => {
  const reasons = [...(input.initialReasons ?? [])];
  let score = Math.max(0, Math.min(100, Math.round(input.initialScore)));
  let materiality = input.initialMateriality;
  const dailyMove = finiteMagnitude(input.market?.dailyReturnPercent);
  const volatilityRatio = finiteMagnitude(input.market?.returnVolatilityRatio);
  const volumeRatio = finiteMagnitude(input.market?.relativeVolume);
  const gap = finiteMagnitude(input.market?.gapPercent);
  const marketAnomalyTriggered =
    dailyMove >= 5 || volatilityRatio >= 2.5 || volumeRatio >= 3 || gap >= 4;

  if (marketAnomalyTriggered) {
    score = Math.max(
      score,
      dailyMove >= 25 || (dailyMove >= 15 && volumeRatio >= 5)
        ? 95
        : dailyMove >= 8 || volumeRatio >= 5
          ? 82
          : 68,
    );
    reasons.push(
      `Market reaction crossed a deterministic anomaly threshold (${dailyMove.toFixed(1)}% move, ${volumeRatio.toFixed(1)}x volume, ${volatilityRatio.toFixed(1)}x volatility).`,
    );
  }
  if (input.eventTypes.some((eventType) => strategicTypes.has(eventType))) {
    score = Math.max(score, 75);
    reasons.push('A strategic event type requires impact analysis.');
  }
  if ((input.independentSourceCount ?? 0) >= 3) {
    score = Math.max(score, 62);
    reasons.push('At least three independent sources confirm the catalyst.');
  }

  if (score >= 90) materiality = 'EXTREME';
  else if (score >= 75 || rank(materiality) >= rank('HIGH'))
    materiality = rank(materiality) >= rank('EXTREME') ? 'EXTREME' : 'HIGH';
  else if (score >= 50 || rank(materiality) >= rank('MEDIUM'))
    materiality = 'MEDIUM';
  else if (score >= 20 || materiality === 'LOW') materiality = 'LOW';
  else materiality = 'NONE';

  // Hard invariant: HIGH and EXTREME never become STORE/STATE_UPDATE.
  const shouldAnalyze =
    rank(materiality) >= rank('MEDIUM') || marketAnomalyTriggered;
  const action: EventAction =
    materiality === 'EXTREME'
      ? 'IMMEDIATE_ANALYSIS'
      : materiality === 'HIGH'
        ? 'FULL_ANALYSIS'
        : shouldAnalyze
          ? 'TARGETED_ANALYSIS'
          : 'STATE_UPDATE';

  return {
    shouldAnalyze,
    materiality,
    action,
    score,
    reasons: [...new Set(reasons)],
    marketAnomalyTriggered,
  };
};
