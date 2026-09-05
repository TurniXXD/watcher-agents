import { describe, expect, it } from 'vitest';
import {
  assessInstitutionalPositioning,
  assessOptionsPositioning,
  assessShortInterest,
} from '../stock-domain/advanced.js';

describe('advanced signal assessments', () => {
  it('flags unusual options activity but keeps it direction-neutral', () => {
    expect(
      assessOptionsPositioning(
        { callVolume: 2_000, putVolume: 1_000, maxVolumeOiRatio: 2.5 },
        [900, 1_100, 1_000],
      ),
    ).toMatchObject({ anomaly: true, volumeBaselineMultiple: 3 });
  });

  it('requires a material institutional change', () => {
    expect(assessInstitutionalPositioning(4.99).anomaly).toBe(false);
    expect(assessInstitutionalPositioning(-5).anomaly).toBe(true);
  });

  it('flags either a short-interest change or elevated days to cover', () => {
    expect(
      assessShortInterest({ changePercent: 2, daysToCover: 5 }),
    ).toMatchObject({ anomaly: true });
    expect(
      assessShortInterest({ changePercent: 2, daysToCover: 2 }),
    ).toMatchObject({ anomaly: false });
  });
});
