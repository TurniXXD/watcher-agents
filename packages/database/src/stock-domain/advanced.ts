export type AdvancedSignalPolicy = {
  optionsVolumeOiRatio: number;
  optionsVolumeBaselineMultiple: number;
  minimumOptionsBaseline: number;
  institutionalChangePercent: number;
  shortInterestChangePercent: number;
  shortInterestDaysToCover: number;
};

export const defaultAdvancedSignalPolicy: AdvancedSignalPolicy = {
  optionsVolumeOiRatio: 2,
  optionsVolumeBaselineMultiple: 3,
  minimumOptionsBaseline: 3,
  institutionalChangePercent: 5,
  shortInterestChangePercent: 10,
  shortInterestDaysToCover: 5,
};

export type AdvancedAssessment = {
  anomaly: boolean;
  reasons: string[];
  score: number;
};

export const assessOptionsPositioning = (
  input: {
    callVolume: number;
    putVolume: number;
    maxVolumeOiRatio: number | null;
  },
  historicalAggregateVolumes: number[],
  policy: AdvancedSignalPolicy = defaultAdvancedSignalPolicy,
): AdvancedAssessment & { volumeBaselineMultiple: number | null } => {
  const currentVolume = input.callVolume + input.putVolume;
  const baseline =
    historicalAggregateVolumes.length >= policy.minimumOptionsBaseline
      ? historicalAggregateVolumes.reduce((sum, value) => sum + value, 0) /
        historicalAggregateVolumes.length
      : null;
  const volumeBaselineMultiple =
    baseline !== null && baseline > 0 ? currentVolume / baseline : null;
  const reasons: string[] = [];
  if (
    input.maxVolumeOiRatio !== null &&
    input.maxVolumeOiRatio >= policy.optionsVolumeOiRatio
  ) {
    reasons.push(
      `A contract's volume/open-interest ratio reached ${input.maxVolumeOiRatio.toFixed(2)}x.`,
    );
  }
  if (
    volumeBaselineMultiple !== null &&
    volumeBaselineMultiple >= policy.optionsVolumeBaselineMultiple
  ) {
    reasons.push(
      `Aggregate options volume reached ${volumeBaselineMultiple.toFixed(2)}x its recent baseline.`,
    );
  }
  if (reasons.length > 0) {
    reasons.push(
      'Options activity alone does not establish direction or informed trading.',
    );
  }
  return {
    anomaly: reasons.length > 0,
    reasons,
    score: reasons.length > 1 ? 68 : reasons.length === 1 ? 58 : 20,
    volumeBaselineMultiple,
  };
};

export const assessInstitutionalPositioning = (
  changePercent: number | null,
  policy: AdvancedSignalPolicy = defaultAdvancedSignalPolicy,
): AdvancedAssessment => {
  const anomaly =
    changePercent !== null &&
    Math.abs(changePercent) >= policy.institutionalChangePercent;
  return {
    anomaly,
    reasons: anomaly
      ? [
          `Reported institutional holdings changed ${changePercent.toFixed(2)}%, above the ${policy.institutionalChangePercent}% threshold.`,
          'Periodic holdings reports are delayed and do not reveal current intent.',
        ]
      : [],
    score: anomaly ? 56 : 20,
  };
};

export const assessShortInterest = (
  input: { changePercent: number | null; daysToCover: number | null },
  policy: AdvancedSignalPolicy = defaultAdvancedSignalPolicy,
): AdvancedAssessment => {
  const reasons: string[] = [];
  if (
    input.changePercent !== null &&
    Math.abs(input.changePercent) >= policy.shortInterestChangePercent
  ) {
    reasons.push(
      `Reported short interest changed ${input.changePercent.toFixed(2)}%, above the ${policy.shortInterestChangePercent}% threshold.`,
    );
  }
  if (
    input.daysToCover !== null &&
    input.daysToCover >= policy.shortInterestDaysToCover
  ) {
    reasons.push(
      `Days to cover reached ${input.daysToCover.toFixed(2)}, above the ${policy.shortInterestDaysToCover} threshold.`,
    );
  }
  if (reasons.length > 0) {
    reasons.push(
      'Short interest is reported with a delay and is not independently directional.',
    );
  }
  return {
    anomaly: reasons.length > 0,
    reasons,
    score: reasons.length > 2 ? 64 : reasons.length > 0 ? 54 : 20,
  };
};
