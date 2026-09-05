import {
  decisionInputsSchema,
  decisionResultSchema,
  type DecisionInputs,
  type DecisionResult,
  type NumericRange,
  type StockThesisState,
} from '@watcher/core';

const midpoint = ({ minimum, maximum }: NumericRange): number =>
  (minimum + maximum) / 2;

const validatedInputs = (inputs: DecisionInputs): DecisionInputs => {
  const parsed = decisionInputsSchema.parse(inputs);
  const probabilities = Object.values(parsed.scenarios).map(
    ({ probabilityPercent }) => {
      if (probabilityPercent.minimum < 0 || probabilityPercent.maximum > 100) {
        throw new Error('Scenario probability ranges must stay within 0-100%');
      }
      return midpoint(probabilityPercent);
    },
  );
  const total = probabilities.reduce(
    (sum, probability) => sum + probability,
    0,
  );
  if (total < 80 || total > 120) {
    throw new Error(
      'Scenario probability midpoints must form a plausible distribution',
    );
  }
  for (const probability of Object.values(parsed.probabilityHigher)) {
    if (probability && (probability.minimum < 0 || probability.maximum > 100)) {
      throw new Error('Probability-higher ranges must stay within 0-100%');
    }
  }
  if (parsed.scenarios.bear.expectedReturnPercent.maximum > 0) {
    throw new Error('Bear-case return range must not be positive');
  }
  return parsed;
};

const expectedValue = (inputs: DecisionInputs): number => {
  const scenarios = Object.values(inputs.scenarios);
  const weights = scenarios.map(({ probabilityPercent }) =>
    midpoint(probabilityPercent),
  );
  const totalWeight = weights.reduce(
    (sum, probability) => sum + probability,
    0,
  );
  return scenarios.reduce(
    (total, scenario, index) =>
      total +
      (weights[index]! / totalWeight) *
        midpoint(scenario.expectedReturnPercent),
    0,
  );
};

const asymmetryFor = (
  expectedValuePercent: number,
  downsidePercent: number,
): DecisionResult['asymmetry'] => {
  if (expectedValuePercent <= 0) return 'POOR';
  const ratio = expectedValuePercent / Math.max(1, downsidePercent);
  if (ratio >= 1.5 && expectedValuePercent >= 20) return 'EXCEPTIONAL';
  if (ratio >= 1 && expectedValuePercent >= 12) return 'VERY_GOOD';
  if (ratio >= 0.5 && expectedValuePercent >= 6) return 'GOOD';
  return 'FAIR';
};

const positionRange = (
  recommendation: DecisionResult['recommendation'],
  state: StockThesisState,
  inputs: DecisionInputs,
): NumericRange => {
  const baseMaximum = {
    STRONG_BUY: 6,
    BUY: 4,
    SMALL_POSITION: 2,
    WATCH: 0,
    HOLD: 0,
    WAIT: 0,
    AVOID: 0,
    SELL: 0,
    INSUFFICIENT_DATA: 0,
  }[recommendation];
  if (baseMaximum === 0) return { minimum: 0, maximum: 0 };
  let adjustment = Math.min(state.confidence, state.dataCoverage / 100);
  if (inputs.binaryCatalystExposure) adjustment *= 0.5;
  if (inputs.volatilityRisk === 'HIGH') adjustment *= 0.6;
  if (inputs.volatilityRisk === 'UNKNOWN') adjustment *= 0.75;
  const bearDownside = Math.abs(
    Math.min(0, midpoint(inputs.scenarios.bear.expectedReturnPercent)),
  );
  if (bearDownside >= 30) adjustment *= 0.6;
  const maximum = Math.round(baseMaximum * adjustment * 10) / 10;
  return {
    minimum: Math.min(0.5, maximum),
    maximum,
  };
};

export const evaluateDecision = (
  state: StockThesisState,
  rawInputs: DecisionInputs,
): DecisionResult => {
  const inputs = validatedInputs(rawInputs);
  const coverageInsufficient = state.dataCoverage < 50;
  const confidenceInsufficient = state.confidence < 0.45;
  const hasProbabilityEvidence = Object.values(inputs.probabilityHigher).some(
    (probability) => probability !== null,
  );
  if (
    coverageInsufficient ||
    confidenceInsufficient ||
    !hasProbabilityEvidence
  ) {
    return decisionResultSchema.parse({
      recommendation: 'INSUFFICIENT_DATA',
      expectedValuePercent: null,
      asymmetry: 'INSUFFICIENT_DATA',
      probabilityHigher: inputs.probabilityHigher,
      scenarios: inputs.scenarios,
      pricedIn: inputs.pricedIn,
      maxRecommendedPositionPercent: { minimum: 0, maximum: 0 },
      rationale: [
        coverageInsufficient
          ? `Data coverage is only ${Math.round(state.dataCoverage)}%.`
          : confidenceInsufficient
            ? `Analysis confidence is only ${Math.round(state.confidence * 100)}%.`
            : 'No supported probability horizon is available.',
        'No position is suggested while material evidence is insufficient.',
      ],
      humanReviewRequired: true,
    });
  }

  const value = expectedValue(inputs);
  const roundedValue = Math.round(value * 10) / 10;
  const downside = Math.abs(
    Math.min(0, midpoint(inputs.scenarios.bear.expectedReturnPercent)),
  );
  const asymmetry = asymmetryFor(value, downside);
  const expectationsRich =
    inputs.pricedIn.classification === 'MOSTLY_PRICED_IN' ||
    inputs.pricedIn.classification === 'OVERPRICED_EXPECTATIONS';
  let recommendation: DecisionResult['recommendation'];
  if (value <= -5 || state.netSignal <= -2) {
    recommendation = 'AVOID';
  } else if (value < 0) {
    recommendation = 'WAIT';
  } else if (
    value >= 20 &&
    state.netSignal >= 2.5 &&
    state.dataCoverage >= 85 &&
    state.confidence >= 0.75 &&
    asymmetry === 'EXCEPTIONAL' &&
    !expectationsRich
  ) {
    recommendation = 'STRONG_BUY';
  } else if (
    value >= 10 &&
    state.netSignal >= 2 &&
    state.dataCoverage >= 75 &&
    state.confidence >= 0.65 &&
    !expectationsRich
  ) {
    recommendation = 'BUY';
  } else if (value >= 5 && state.netSignal >= 1 && !expectationsRich) {
    recommendation = 'SMALL_POSITION';
  } else if (value > 0) {
    recommendation = 'WATCH';
  } else {
    recommendation = 'WAIT';
  }
  const rationale = [
    `Scenario-weighted expected return is ${roundedValue.toFixed(1)}%; this is not a guarantee.`,
    `Net signal is ${state.netSignal.toFixed(2)} with ${Math.round(state.dataCoverage)}% data coverage.`,
    inputs.pricedIn.explanation,
    inputs.downsideExplanation,
    ...(inputs.binaryCatalystExposure
      ? ['Binary catalyst exposure reduces the maximum suggested size.']
      : []),
  ];
  const provisional = {
    recommendation,
    expectedValuePercent: roundedValue,
    asymmetry,
    probabilityHigher: inputs.probabilityHigher,
    scenarios: inputs.scenarios,
    pricedIn: inputs.pricedIn,
    maxRecommendedPositionPercent: { minimum: 0, maximum: 0 },
    rationale,
    humanReviewRequired: true,
  } satisfies DecisionResult;
  return decisionResultSchema.parse({
    ...provisional,
    maxRecommendedPositionPercent: positionRange(recommendation, state, inputs),
  });
};
