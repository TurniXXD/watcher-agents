import { describe, expect, it } from 'vitest';
import { calculateEconomics, incrementalRoute } from '../economics.js';

const settings = {
  fuelPriceCzkPerLiter: 35,
  fuelPriceSource: 'test',
  fuelPriceUpdatedAt: new Date('2026-09-22T00:00:00Z'),
  fuelPriceStale: false,
  wearCzkPerKm: 2,
  maintenanceCzkPerKm: 1,
  tyresCzkPerKm: 0.5,
  oilCzkPerKm: 0.25,
  insuranceCzkPerKm: 0.25,
  driverCzkPerHour: 300,
};

describe('transport economics', () => {
  it('shows every deterministic cost component', () => {
    const result = calculateEconomics({
      route: { distanceKm: 100, durationMinutes: 120, provider: 'test' },
      settings,
      consumptionLitersPer100Km: 10,
      revenue: 2_000,
      tollsCzk: 100,
      otherExpensesCzk: 50,
      emptyKm: 10,
    });
    expect(result).toMatchObject({
      fuelCost: 350,
      wearCost: 200,
      maintenanceCost: 100,
      tyreCost: 50,
      oilCost: 25,
      insuranceCost: 25,
      driverCost: 600,
      variableVehicleCost: 400,
      estimatedTotalCost: 1_500,
      profit: 500,
      profitPerKm: 5,
      profitPerHour: 250,
      emptyKm: 10,
    });
  });

  it('charges a planned load only for its incremental route', () => {
    expect(
      incrementalRoute(
        { distanceKm: 224, durationMinutes: 164, provider: 'test' },
        { distanceKm: 205, durationMinutes: 130, provider: 'test' },
      ),
    ).toEqual({
      distanceKm: 19,
      durationMinutes: 34,
      tollsCzk: 0,
      provider: 'test',
    });
  });
});
