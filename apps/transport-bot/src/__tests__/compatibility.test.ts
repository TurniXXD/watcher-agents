import { describe, expect, it } from 'vitest';
import { checkCombinedCargo, checkCompatibility } from '../compatibility.js';
import type { TransportRequest, VehicleProfile } from '../types.js';

const vehicle: VehicleProfile = {
  manufacturer: 'VW',
  model: 'Transporter',
  year: 2013,
  fuelType: 'diesel',
  consumptionLitersPer100Km: 8.5,
  maximumPermittedWeightKg: 3_000,
  curbWeightKg: 2_000,
  maximumPayloadKg: 1_000,
  cargoLengthCm: 290,
  cargoWidthCm: 170,
  cargoHeightCm: 140,
  usableVolumeM3: 6.9,
  maximumEuroPallets: 3,
  restrictions: [],
  base: { address: 'Brno', latitude: 49.2, longitude: 16.61 },
};

const request = (
  overrides: Partial<TransportRequest['cargo']> = {},
): TransportRequest => ({
  externalId: crypto.randomUUID(),
  source: 'test',
  cargo: {
    description: 'Box',
    weightKg: 300,
    lengthCm: 120,
    widthCm: 80,
    heightCm: 100,
    volumeM3: 1,
    palletCount: 1,
    specialRequirements: [],
    ...overrides,
  },
  currency: 'CZK',
  publishedAt: new Date(),
  raw: {},
});

describe('vehicle compatibility', () => {
  it('rejects overweight cargo with an explainable reason', () => {
    expect(checkCompatibility(request({ weightKg: 1_140 }), vehicle)).toEqual({
      classification: 'INCOMPATIBLE',
      reasons: ['payload exceeded by 140 kg'],
      verificationRequired: [],
    });
  });

  it('never assumes unknown dimensions fit', () => {
    const result = checkCompatibility(
      request({ lengthCm: undefined, widthCm: undefined, heightCm: undefined }),
      vehicle,
    );
    expect(result.classification).toBe('POSSIBLY_COMPATIBLE');
    expect(result.verificationRequired).toContain('cargo dimensions');
  });

  it('checks floor packing as well as combined weight', () => {
    const first = request({ lengthCm: 200, widthCm: 100, weightKg: 100 });
    const second = request({ lengthCm: 200, widthCm: 100, weightKg: 100 });
    const result = checkCombinedCargo([first, second], vehicle);
    expect(result.classification).toBe('INCOMPATIBLE');
    expect(result.reasons).toContain(
      'combined cargo cannot be packed in the cargo floor',
    );
  });
});
