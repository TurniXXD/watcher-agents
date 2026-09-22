import type {
  DataConfidence,
  Opportunity,
  OpportunityPreferences,
  Rejection,
} from './types.js';

const confidenceRank: Record<DataConfidence, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
};

export const scoreOpportunity = (
  opportunity: Omit<Opportunity, 'score'>,
): number => {
  const { economics } = opportunity;
  const confidenceMultiplier = [0.45, 0.75, 1][
    confidenceRank[opportunity.confidence]
  ]!;
  const routeEfficiency = Math.max(
    0,
    1 -
      (economics.emptyKm + economics.detourKm) /
        Math.max(opportunity.route.distanceKm, 1),
  );
  const utilizationBonus = opportunity.requests.length > 1 ? 10 : 0;
  return (
    Math.round(
      (Math.max(0, economics.profit) / 100 +
        Math.max(0, economics.profitPerHour) / 50 +
        routeEfficiency * 20 +
        utilizationBonus -
        economics.detourKm / 5 -
        economics.emptyKm / 5) *
        confidenceMultiplier *
        100,
    ) / 100
  );
};

export const thresholdRejections = (
  opportunity: Opportunity,
  preferences: OpportunityPreferences,
): Rejection[] => {
  const rejected: Rejection[] = [];
  if (opportunity.economics.profit < preferences.minimumProfitCzk)
    rejected.push({
      code: 'MINIMUM_PROFIT',
      explanation: `estimated profit ${Math.round(opportunity.economics.profit)} CZK < required ${preferences.minimumProfitCzk} CZK`,
    });
  if (opportunity.economics.profitPerHour < preferences.minimumProfitPerHourCzk)
    rejected.push({
      code: 'MINIMUM_PROFIT_PER_HOUR',
      explanation: `estimated profit/hour ${Math.round(opportunity.economics.profitPerHour)} CZK < required ${preferences.minimumProfitPerHourCzk} CZK`,
    });
  if (opportunity.economics.emptyKm > preferences.maximumEmptyKm)
    rejected.push({
      code: 'MAXIMUM_EMPTY_DISTANCE',
      explanation: `${Math.round(opportunity.economics.emptyKm)} km empty > configured ${preferences.maximumEmptyKm} km`,
    });
  if (opportunity.economics.detourKm > preferences.maximumDetourKm)
    rejected.push({
      code: 'MAXIMUM_DETOUR',
      explanation: `${Math.round(opportunity.economics.detourKm)} km detour > configured ${preferences.maximumDetourKm} km`,
    });
  if (
    confidenceRank[opportunity.confidence] <
    confidenceRank[preferences.minimumConfidence]
  )
    rejected.push({
      code: 'MINIMUM_CONFIDENCE',
      explanation: `data confidence ${opportunity.confidence} < required ${preferences.minimumConfidence}`,
    });
  return rejected;
};
