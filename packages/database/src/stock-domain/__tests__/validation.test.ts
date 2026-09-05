import { describe, expect, it } from 'vitest';
import {
  calculateCalibration,
  calculatePriceOutcome,
  probabilityMidpoint,
  summarizeOutcomes,
} from '../validation.js';

const point = (
  day: number,
  close: number,
  overrides: Partial<{
    open: number;
    high: number;
    low: number;
    ninetyDayReturnPercent: number | null;
  }> = {},
) => ({
  observedAt: new Date(`2026-01-${String(day).padStart(2, '0')}T16:00:00Z`),
  open: overrides.open ?? close,
  high: overrides.high ?? close,
  low: overrides.low ?? close,
  close,
  ...(overrides.ninetyDayReturnPercent === undefined
    ? {}
    : { ninetyDayReturnPercent: overrides.ninetyDayReturnPercent }),
});

describe('validation metrics', () => {
  it('calculates only price horizons represented by stored snapshots', () => {
    const outcome = calculatePriceOutcome(new Date('2026-01-01T18:00:00Z'), [
      point(1, 100, { ninetyDayReturnPercent: 12 }),
      point(2, 110, { open: 105, high: 112, low: 95 }),
      point(8, 120, { high: 125, low: 108 }),
    ]);

    expect(outcome).toMatchObject({
      anchorPrice: 100,
      nextOpenPrice: 105,
      returnOneHourPercent: null,
      returnOneDayPercent: 10,
      returnSevenDayPercent: 20,
      returnThirtyDayPercent: null,
      maximumFavorablePercent: 25,
      maximumAdversePercent: -5,
      marketRegime: 'BULL',
    });
    expect(outcome.completedHorizons).toEqual(['ONE_DAY', 'SEVEN_DAYS']);
  });

  it('does not invent an anchor when no historical price existed', () => {
    expect(
      calculatePriceOutcome(new Date('2026-01-01T00:00:00Z'), [point(2, 100)]),
    ).toMatchObject({ anchorPrice: null, completedHorizons: [] });
  });

  it('summarizes returns and drawdown excursions', () => {
    expect(
      summarizeOutcomes([
        {
          returnPercent: 10,
          maximumFavorablePercent: 12,
          maximumAdversePercent: -2,
        },
        {
          returnPercent: -4,
          maximumFavorablePercent: 1,
          maximumAdversePercent: -8,
        },
      ]),
    ).toEqual({
      sampleSize: 2,
      hitRatePercent: 50,
      averageReturnPercent: 3,
      medianReturnPercent: 3,
      averageMaximumFavorablePercent: 6.5,
      averageMaximumAdversePercent: -5,
      worstMaximumAdversePercent: -8,
    });
  });

  it('calibrates predictions using fixed probability buckets', () => {
    const buckets = calculateCalibration([
      { predictedPercent: 52, returnPercent: 5 },
      { predictedPercent: 54, returnPercent: -1 },
      { predictedPercent: 82, returnPercent: 3 },
    ]);
    expect(buckets[0]).toMatchObject({
      label: '50–55%',
      sampleSize: 2,
      predictedAveragePercent: 53,
      realizedHigherPercent: 50,
      calibrationErrorPoints: -3,
    });
    expect(buckets.at(-1)).toMatchObject({
      label: '80%+',
      sampleSize: 1,
      realizedHigherPercent: 100,
    });
    expect(probabilityMidpoint({ minimum: 55, maximum: 65 })).toBe(60);
  });
});
