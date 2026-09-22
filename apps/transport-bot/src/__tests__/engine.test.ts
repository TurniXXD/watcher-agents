import { describe, expect, it } from 'vitest';
import { OpportunityEngine } from '../engine.js';
import type {
  CostSettings,
  OpportunityPreferences,
  PlannedTrip,
  TransportRequest,
  VehicleProfile,
} from '../types.js';

const vehicle: VehicleProfile = {
  manufacturer: 'VW',
  model: 'Transporter',
  year: 2013,
  fuelType: 'diesel',
  consumptionLitersPer100Km: 8.5,
  maximumPermittedWeightKg: 3000,
  curbWeightKg: 2000,
  maximumPayloadKg: 1000,
  cargoLengthCm: 290,
  cargoWidthCm: 170,
  cargoHeightCm: 140,
  usableVolumeM3: 6.9,
  maximumEuroPallets: 3,
  restrictions: [],
  base: { address: 'Brno', latitude: 49.2, longitude: 16.61 },
};
const costs: CostSettings = {
  fuelPriceCzkPerLiter: 35,
  fuelPriceSource: 'test',
  fuelPriceUpdatedAt: new Date(),
  fuelPriceStale: false,
  wearCzkPerKm: 1,
  maintenanceCzkPerKm: 1,
  tyresCzkPerKm: 0.5,
  oilCzkPerKm: 0.25,
  insuranceCzkPerKm: 0.25,
  driverCzkPerHour: 0,
};
const preferences: OpportunityPreferences = {
  minimumProfitCzk: 500,
  minimumProfitPerHourCzk: 300,
  maximumEmptyKm: 40,
  maximumDetourKm: 30,
  maximumAdditionalMinutes: 60,
  minimumConfidence: 'MEDIUM',
  multiplePickups: false,
};
const job: TransportRequest = {
  externalId: 'one',
  source: 'test',
  sourceUrl: 'https://example.com/one',
  pickup: { address: 'Brno', latitude: 49.2, longitude: 16.61 },
  delivery: { address: 'Jihlava', latitude: 49.4, longitude: 15.59 },
  pickupWindow: {
    from: new Date('2026-09-23T13:00:00Z'),
    to: new Date('2026-09-23T14:00:00Z'),
  },
  deliveryWindow: {
    from: new Date('2026-09-23T14:00:00Z'),
    to: new Date('2026-09-23T16:00:00Z'),
  },
  cargo: {
    description: 'EUR pallet',
    weightKg: 320,
    lengthCm: 120,
    widthCm: 80,
    heightCm: 100,
    volumeM3: 0.96,
    palletCount: 1,
    specialRequirements: [],
  },
  offeredPrice: 1500,
  currency: 'CZK',
  publishedAt: new Date(),
  raw: {},
};

describe('opportunity engine', () => {
  it('ranks a planned-trip load by incremental economics', async () => {
    const routes = [
      { distanceKm: 205, durationMinutes: 130, provider: 'test' },
      { distanceKm: 0, durationMinutes: 0, provider: 'test' },
      { distanceKm: 90, durationMinutes: 80, provider: 'test' },
      { distanceKm: 134, durationMinutes: 64, provider: 'test' },
    ];
    const engine = new OpportunityEngine({
      route: async () => routes.shift()!,
    });
    const trip: PlannedTrip = {
      origin: vehicle.base,
      destination: { address: 'Prague', latitude: 50.08, longitude: 14.43 },
      departureWindow: {
        from: new Date('2026-09-23T13:00:00Z'),
        to: new Date('2026-09-23T14:00:00Z'),
      },
      maximumDetourKm: 30,
      maximumAdditionalMinutes: 60,
      multiplePickups: false,
    };
    const result = await engine.evaluatePlannedTrip({
      request: job,
      trip,
      vehicle,
      costs,
      preferences,
    });
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.opportunity.economics.detourKm).toBe(19);
      expect(result.opportunity.economics.estimatedTotalCost).toBe(113.53);
      expect(result.opportunity.economics.profit).toBe(1386.48);
    }
  });

  it('records a concrete threshold rejection', async () => {
    const engine = new OpportunityEngine({
      route: async () => ({
        distanceKm: 80,
        durationMinutes: 60,
        provider: 'test',
      }),
    });
    const result = await engine.evaluateIndividual({
      request: { ...job, offeredPrice: 100 },
      vehicle,
      costs,
      preferences,
    });
    expect(result.accepted).toBe(false);
    if (!result.accepted)
      expect(result.rejections.map(({ code }) => code)).toContain(
        'MINIMUM_PROFIT',
      );
  });
});
