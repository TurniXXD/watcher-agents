import { describe, expect, it } from 'vitest';
import {
  discoveryOpportunityScore,
  type DiscoveryCatalystAssessment,
} from '../discovery-catalyst.js';

const assessment = (
  overrides: Partial<DiscoveryCatalystAssessment> = {},
): DiscoveryCatalystAssessment => ({
  qualifies: true,
  catalyst: 'Confirmed regulatory approval',
  direction: 'POSITIVE',
  catalystStrength: 8,
  confirmation: 'OFFICIAL_SOURCE',
  upsidePotential: 8,
  pricedIn: 'NOT_PRICED_IN',
  explanation: 'The approval unlocks a new revenue stream.',
  risks: ['Commercial execution'],
  ...overrides,
});

describe('discoveryOpportunityScore', () => {
  it('rewards a confirmed catalyst rather than a historical price move', () => {
    const score = discoveryOpportunityScore(assessment(), 2);

    expect(score).toBe(79);
  });

  it('reduces the score when a large move likely already priced in the catalyst', () => {
    const score = discoveryOpportunityScore(
      assessment({ pricedIn: 'MOSTLY_PRICED_IN' }),
      80,
    );

    expect(score).toBe(45);
  });
});
