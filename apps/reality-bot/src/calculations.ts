import type {
  InvestmentModel,
  ListingEconomics,
  RealityListing,
} from './types.js';

const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export const monthlyMortgagePayment = (
  principalCzk: number,
  annualRatePercent: number,
  termYears: number,
): number => {
  if (principalCzk <= 0 || termYears <= 0) return 0;
  const payments = termYears * 12;
  const rate = annualRatePercent / 100 / 12;
  if (rate === 0) return round(principalCzk / payments);
  return round(
    (principalCzk * rate * (1 + rate) ** payments) /
      ((1 + rate) ** payments - 1),
  );
};

export const grossYield = (
  monthlyRentCzk: number | undefined,
  purchasePriceCzk: number,
): number | undefined =>
  monthlyRentCzk === undefined
    ? undefined
    : round((monthlyRentCzk * 12 * 100) / purchasePriceCzk);

export const netYield = (
  listing: RealityListing,
  model: InvestmentModel,
): number | undefined => {
  if (listing.estimatedMonthlyRentCzk === undefined) return undefined;
  const annualRent =
    listing.estimatedMonthlyRentCzk * 12 * (1 - model.vacancyPercent / 100);
  const annualCosts =
    (listing.annualOwnerCostsCzk ?? 0) +
    listing.priceCzk * (model.annualMaintenancePercent / 100) +
    model.annualInsuranceCzk +
    model.otherAnnualOwnerCostsCzk;
  const invested = listing.priceCzk + (listing.acquisitionCostsCzk ?? 0);
  return round(((annualRent - annualCosts) * 100) / invested);
};

export const evaluateListing = (
  listing: RealityListing,
  model: InvestmentModel,
  currentMortgageRatePercent: number,
  firstSeenAt: Date,
  priceHistory: readonly { priceCzk: number; observedAt: Date }[] = [],
  now = new Date(),
): ListingEconomics => {
  const loan = listing.priceCzk * (1 - model.equityPercent / 100);
  const monthlyOperatingCosts = round(
    ((listing.annualOwnerCostsCzk ?? 0) +
      listing.priceCzk * (model.annualMaintenancePercent / 100) +
      model.annualInsuranceCzk +
      model.otherAnnualOwnerCostsCzk) /
      12 +
      ((listing.estimatedMonthlyRentCzk ?? 0) * model.vacancyPercent) / 100,
  );
  const cashflowFor = (rate: number): number =>
    round(
      (listing.estimatedMonthlyRentCzk ?? 0) -
        monthlyMortgagePayment(loan, rate, model.termYears) -
        monthlyOperatingCosts,
    );
  const pricePerM2Czk = round(listing.priceCzk / listing.floorAreaM2);
  const discountToLocalPercent = listing.localMedianPricePerM2Czk
    ? round(
        ((pricePerM2Czk - listing.localMedianPricePerM2Czk) * 100) /
          listing.localMedianPricePerM2Czk,
      )
    : undefined;
  const firstPrice = priceHistory[0]?.priceCzk;
  const priceReductionPercent =
    firstPrice && firstPrice > listing.priceCzk
      ? round(((firstPrice - listing.priceCzk) * 100) / firstPrice)
      : undefined;
  const gross = grossYield(listing.estimatedMonthlyRentCzk, listing.priceCzk);
  const net = netYield(listing, model);
  const cashflow = cashflowFor(currentMortgageRatePercent);
  let score = 35;
  if (gross !== undefined)
    score += Math.max(-15, Math.min(25, (gross - 4) * 8));
  if (net !== undefined) score += Math.max(-10, Math.min(20, (net - 3) * 7));
  if (discountToLocalPercent !== undefined)
    score += Math.max(-10, Math.min(20, -discountToLocalPercent));
  score += Math.max(-15, Math.min(15, cashflow / 500));
  if (priceReductionPercent !== undefined)
    score += Math.min(10, priceReductionPercent / 2);
  const daysOnMarket = Math.max(
    0,
    Math.floor((now.getTime() - firstSeenAt.getTime()) / 86_400_000),
  );
  if (daysOnMarket >= 60) score += 4;

  return {
    ...(gross !== undefined ? { grossYieldPercent: gross } : {}),
    ...(net !== undefined ? { netYieldPercent: net } : {}),
    pricePerM2Czk,
    ...(discountToLocalPercent !== undefined ? { discountToLocalPercent } : {}),
    monthlyPaymentCzk: monthlyMortgagePayment(
      loan,
      currentMortgageRatePercent,
      model.termYears,
    ),
    monthlyOperatingCostsCzk: monthlyOperatingCosts,
    cashflowCzk: cashflow,
    stressCashflows: Object.fromEntries(
      [...new Set([3, currentMortgageRatePercent, 5, 6, 7])]
        .sort((left, right) => left - right)
        .map((rate) => [`${rate.toFixed(2)}%`, cashflowFor(rate)]),
    ),
    daysOnMarket,
    ...(firstPrice && firstPrice !== listing.priceCzk
      ? { previousPriceCzk: firstPrice }
      : {}),
    ...(priceReductionPercent !== undefined ? { priceReductionPercent } : {}),
    score: Math.round(Math.max(0, Math.min(100, score))),
  };
};
