import type { StockIntelligenceResult, StockThesisState } from '@watcher/core';

export type AlertEvent = {
  eventType: string;
  materiality: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  title: string;
  magnitude: Record<string, unknown>;
  hasExtremeCatalyst: boolean;
};

export type PreviousAlertState = Pick<
  StockThesisState,
  'verdict' | 'attentionScore' | 'decision'
> | null;

export type AlertCandidate = {
  type:
    | 'HIGH_PRIORITY'
    | 'THESIS_CHANGE'
    | 'VERDICT_CHANGE'
    | 'EXTREME_CATALYST'
    | 'INSIDER_CLUSTER'
    | 'UNEXPLAINED_ACTIVITY'
    | 'ASYMMETRY_CHANGE';
  severity: 'INFO' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  title: string;
  reasons: string[];
};

const materialVerdictChange = (
  previous: string | undefined,
  current: string,
): boolean => previous !== undefined && previous !== current;

export const evaluateStockAlert = (
  event: AlertEvent,
  intelligence: StockIntelligenceResult,
  previous: PreviousAlertState,
  attentionThreshold: number,
): AlertCandidate | null => {
  const reasons: string[] = [];
  const unexplained = event.magnitude.unexplained === true;
  const clusterSize =
    typeof event.magnitude.clusterSize === 'number'
      ? event.magnitude.clusterSize
      : 0;
  const attentionCrossed =
    intelligence.state.attentionScore >= attentionThreshold &&
    (previous?.attentionScore ?? 0) < attentionThreshold;
  const verdictChanged = materialVerdictChange(
    previous?.verdict,
    intelligence.state.verdict,
  );
  const thesisChanged = intelligence.targeted.thesisChange !== 'UNCHANGED';
  const previousAsymmetry = previous?.decision?.asymmetry;
  const currentAsymmetry = intelligence.decision?.asymmetry;
  const asymmetryChanged =
    previousAsymmetry !== undefined &&
    currentAsymmetry !== undefined &&
    previousAsymmetry !== currentAsymmetry;

  if (event.materiality === 'HIGH' || event.materiality === 'EXTREME') {
    reasons.push(`${event.materiality} canonical-event materiality.`);
  }
  if (attentionCrossed) {
    reasons.push(
      `Attention crossed ${attentionThreshold} and reached ${intelligence.state.attentionScore}.`,
    );
  }
  if (verdictChanged) {
    reasons.push(
      `Verdict changed from ${previous?.verdict} to ${intelligence.state.verdict}.`,
    );
  }
  if (thesisChanged) {
    reasons.push(`Thesis ${intelligence.targeted.thesisChange.toLowerCase()}.`);
  }
  if (asymmetryChanged) {
    reasons.push(
      `Expected-value asymmetry changed from ${previousAsymmetry} to ${currentAsymmetry}.`,
    );
  }
  if (event.hasExtremeCatalyst) {
    reasons.push('An EXTREME catalyst is active or upcoming.');
  }
  if (clusterSize >= 3) {
    reasons.push(
      `${clusterSize} distinct insider buyers form a 30-day cluster.`,
    );
  }
  if (unexplained) {
    reasons.push(
      'The price/volume anomaly has no confirmed public primary driver; no information leak is inferred.',
    );
  }
  if (reasons.length === 0) return null;

  if (unexplained) {
    return {
      type: 'UNEXPLAINED_ACTIVITY',
      severity: event.materiality === 'EXTREME' ? 'EXTREME' : 'HIGH',
      title: `Unexplained market anomaly — ${intelligence.state.ticker}`,
      reasons,
    };
  }
  if (event.hasExtremeCatalyst) {
    return {
      type: 'EXTREME_CATALYST',
      severity: 'EXTREME',
      title: `Extreme catalyst — ${intelligence.state.ticker}`,
      reasons,
    };
  }
  if (clusterSize >= 3) {
    return {
      type: 'INSIDER_CLUSTER',
      severity: event.materiality === 'EXTREME' ? 'EXTREME' : 'HIGH',
      title: `Insider purchase cluster — ${intelligence.state.ticker}`,
      reasons,
    };
  }
  if (event.materiality === 'HIGH' || event.materiality === 'EXTREME') {
    return {
      type: 'HIGH_PRIORITY',
      severity: event.materiality,
      title: `High-priority event — ${intelligence.state.ticker}`,
      reasons,
    };
  }
  if (verdictChanged) {
    return {
      type: 'VERDICT_CHANGE',
      severity: 'HIGH',
      title: `Verdict changed — ${intelligence.state.ticker}`,
      reasons,
    };
  }
  if (thesisChanged) {
    return {
      type: 'THESIS_CHANGE',
      severity: 'MEDIUM',
      title: `Thesis changed — ${intelligence.state.ticker}`,
      reasons,
    };
  }
  if (asymmetryChanged) {
    return {
      type: 'ASYMMETRY_CHANGE',
      severity: 'MEDIUM',
      title: `Asymmetry changed — ${intelligence.state.ticker}`,
      reasons,
    };
  }
  return {
    type: 'HIGH_PRIORITY',
    severity: 'HIGH',
    title: `Attention threshold crossed — ${intelligence.state.ticker}`,
    reasons,
  };
};
