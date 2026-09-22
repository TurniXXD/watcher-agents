import type { Opportunity } from './types.js';

const czk = (value: number): string =>
  `${Math.round(value).toLocaleString('cs-CZ')} Kč`;
const km = (value: number): string => `${Math.round(value)} km`;

export const renderOpportunity = (opportunity: Opportunity): string => {
  const request = opportunity.requests[0]!;
  const pickup = request.pickup?.address ?? 'unknown pickup';
  const delivery = request.delivery?.address ?? 'unknown delivery';
  const economics = opportunity.economics;
  const incremental = opportunity.kind !== 'INDIVIDUAL';
  const warning = opportunity.warnings.length
    ? `\n\n⚠️ Verify: ${opportunity.warnings.join(', ')}`
    : '';
  const fuelStatus = '';
  return [
    opportunity.score >= 40
      ? '🔥 HIGH-VALUE MATCH'
      : '✅ Opportunity worth considering',
    '',
    `${pickup} → ${delivery}`,
    `Cargo: ${request.cargo.description}`,
    `Revenue: ${czk(economics.revenue)}`,
    '',
    `${incremental ? 'Additional route' : 'Route'}: ${km(incremental ? economics.detourKm : opportunity.route.distanceKm)}`,
    `Empty distance: ${km(economics.emptyKm)}`,
    '',
    `Fuel: ${czk(economics.fuelCost)}`,
    `Vehicle costs: ${czk(economics.variableVehicleCost)}`,
    `Driver/time: ${czk(economics.driverCost)}`,
    `Tolls/other: ${czk(economics.tollCost + economics.otherExpenses)}`,
    `Estimated total cost: ${czk(economics.estimatedTotalCost)}`,
    '',
    `${incremental ? 'Incremental profit' : 'Estimated profit'}: ${czk(economics.profit)}`,
    `Profit/km: ${czk(economics.profitPerKm)}`,
    `Profit/hour: ${czk(economics.profitPerHour)}`,
    `Confidence: ${opportunity.confidence}${warning}${fuelStatus}`,
  ].join('\n');
};

export const mainKeyboard = {
  keyboard: [
    [{ text: '🔎 Find jobs' }, { text: "🛣️ I'm planning a trip" }],
    [{ text: '🔄 Find return load' }, { text: '🚐 Vehicle' }],
    [{ text: '⚙️ Preferences' }, { text: '📊 Cost settings' }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};
