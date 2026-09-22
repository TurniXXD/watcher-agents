import { describe, expect, it } from 'vitest';
import {
  parsePortfolioRiskProfileRequest,
  renderPortfolioRiskProfile,
} from '../portfolio-risk-profile.js';

describe('portfolio risk profile command', () => {
  it('views the stored profile without an argument', () => {
    expect(parsePortfolioRiskProfileRequest('')).toEqual({ status: 'VIEW' });
  });

  it('applies a preset and explicit warning limits', () => {
    expect(
      parsePortfolioRiskProfileRequest(
        'balanced --max-position 15 --max-sector 35 --max-total-czk 100000',
      ),
    ).toEqual({
      status: 'SET',
      profile: {
        tolerance: 'BALANCED',
        maxSinglePositionPercent: 15,
        maxSectorPercent: 35,
        maxTotalPaperNotionalCzk: 100_000,
      },
    });
  });

  it('allows clearing an optional notional limit but rejects contradictory caps', () => {
    expect(
      parsePortfolioRiskProfileRequest('aggressive --max-total-czk none'),
    ).toMatchObject({
      status: 'SET',
      profile: { maxTotalPaperNotionalCzk: null },
    });
    expect(() =>
      parsePortfolioRiskProfileRequest(
        'balanced --max-position 50 --max-sector 25',
      ),
    ).toThrow('Maximum sector exposure');
  });

  it('states that profile settings do not execute trades', () => {
    expect(
      renderPortfolioRiskProfile({
        tolerance: 'BALANCED',
        maxSinglePositionPercent: 20,
        maxSectorPercent: 40,
        maxTotalPaperNotionalCzk: null,
      }),
    ).toContain(
      'does not evaluate suitability, block a trade, or send an order',
    );
  });
});
