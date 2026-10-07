import { describe, expect, it } from 'vitest';
import {
  evaluateListing,
  grossYield,
  monthlyMortgagePayment,
  netYield,
} from '../calculations.js';
import type { InvestmentModel, RealityListing } from '../types.js';

const model: InvestmentModel = {
  purchasePriceCzk: 3_000_000,
  floorAreaM2: 60,
  equityPercent: 30,
  termYears: 30,
  vacancyPercent: 5,
  annualMaintenancePercent: 1,
  annualInsuranceCzk: 3_000,
  otherAnnualOwnerCostsCzk: 0,
};

const listing: RealityListing = {
  externalId: 'flat-1',
  source: 'licensed-feed',
  url: 'https://example.com/flat-1',
  title: 'Ostrava 2+1',
  location: 'Ostrava',
  disposition: '2+1',
  priceCzk: 2_550_000,
  floorAreaM2: 55,
  estimatedMonthlyRentCzk: 14_500,
  annualOwnerCostsCzk: 12_000,
  acquisitionCostsCzk: 30_000,
  localMedianPricePerM2Czk: 55_000,
};

describe('reality investment calculations', () => {
  it('calculates the annuity payment including a zero-rate case', () => {
    expect(monthlyMortgagePayment(1_000_000, 5, 30)).toBeCloseTo(5368.22, 2);
    expect(monthlyMortgagePayment(1_000_000, 0, 30)).toBeCloseTo(2777.78, 2);
  });

  it('calculates gross and net yield without inventing missing rent', () => {
    expect(grossYield(14_500, 2_550_000)).toBe(6.82);
    expect(grossYield(undefined, 2_550_000)).toBeUndefined();
    expect(netYield(listing, model)).toBeCloseTo(4.84, 2);
  });

  it('produces mortgage stress cashflows, discount and price history', () => {
    const result = evaluateListing(
      listing,
      model,
      5,
      new Date('2026-07-01T00:00:00Z'),
      [
        { priceCzk: 2_890_000, observedAt: new Date('2026-07-01T00:00:00Z') },
        { priceCzk: 2_550_000, observedAt: new Date('2026-09-01T00:00:00Z') },
      ],
      new Date('2026-10-05T00:00:00Z'),
    );

    expect(result.grossYieldPercent).toBe(6.82);
    expect(result.discountToLocalPercent).toBeCloseTo(-15.7, 2);
    expect(result.priceReductionPercent).toBeCloseTo(11.76, 2);
    expect(result.daysOnMarket).toBe(96);
    expect(result.stressCashflows['7.00%']).toBeLessThan(
      result.stressCashflows['5.00%']!,
    );
    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
