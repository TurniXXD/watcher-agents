import type { CostBreakdown, CostSettings, RouteResult } from './types.js';

const money = (value: number): number => Math.round(value * 100) / 100;
const ratio = (numerator: number, denominator: number): number =>
  denominator > 0 ? money(numerator / denominator) : 0;

export const calculateEconomics = (input: {
  route: RouteResult;
  settings: CostSettings;
  consumptionLitersPer100Km: number;
  revenue: number;
  emptyKm?: number;
  detourKm?: number;
  tollsCzk?: number;
  otherExpensesCzk?: number;
}): CostBreakdown => {
  const distance = Math.max(0, input.route.distanceKm);
  const hours = Math.max(0, input.route.durationMinutes / 60);
  const fuelCost =
    (distance / 100) *
    input.consumptionLitersPer100Km *
    input.settings.fuelPriceCzkPerLiter;
  const wearCost = distance * input.settings.wearCzkPerKm;
  const maintenanceCost = distance * input.settings.maintenanceCzkPerKm;
  const tyreCost = distance * input.settings.tyresCzkPerKm;
  const oilCost = distance * input.settings.oilCzkPerKm;
  const insuranceCost = distance * input.settings.insuranceCzkPerKm;
  const driverCost = hours * input.settings.driverCzkPerHour;
  const tollCost = input.tollsCzk ?? input.route.tollsCzk ?? 0;
  const otherExpenses = input.otherExpensesCzk ?? 0;
  const variableVehicleCost =
    wearCost + maintenanceCost + tyreCost + oilCost + insuranceCost;
  const estimatedTotalCost =
    fuelCost + variableVehicleCost + driverCost + tollCost + otherExpenses;
  const profit = input.revenue - estimatedTotalCost;

  return {
    fuelCost: money(fuelCost),
    wearCost: money(wearCost),
    maintenanceCost: money(maintenanceCost),
    tyreCost: money(tyreCost),
    oilCost: money(oilCost),
    insuranceCost: money(insuranceCost),
    driverCost: money(driverCost),
    tollCost: money(tollCost),
    otherExpenses: money(otherExpenses),
    variableVehicleCost: money(variableVehicleCost),
    estimatedTotalCost: money(estimatedTotalCost),
    revenue: money(input.revenue),
    profit: money(profit),
    profitPerKm: ratio(profit, distance),
    profitPerHour: ratio(profit, hours),
    revenuePerKm: ratio(input.revenue, distance),
    emptyKm: money(input.emptyKm ?? 0),
    detourKm: money(input.detourKm ?? 0),
  };
};

export const incrementalRoute = (
  modified: RouteResult,
  baseline: RouteResult,
): RouteResult => ({
  distanceKm: Math.max(0, modified.distanceKm - baseline.distanceKm),
  durationMinutes: Math.max(
    0,
    modified.durationMinutes - baseline.durationMinutes,
  ),
  tollsCzk: Math.max(0, (modified.tollsCzk ?? 0) - (baseline.tollsCzk ?? 0)),
  provider: modified.provider,
});
