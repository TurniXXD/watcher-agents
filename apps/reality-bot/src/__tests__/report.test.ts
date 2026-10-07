import { describe, expect, it } from 'vitest';
import { renderRealityReport } from '../report.js';
import type { InvestmentModel, RealityMetric } from '../types.js';

const metric = (
  externalId: string,
  key: string,
  value: number,
  period: string,
  location?: string,
): RealityMetric => ({
  externalId,
  source: 'test-source',
  category: key.includes('MORTGAGE') ? 'FINANCING' : 'PRICES',
  metric: key,
  value,
  unit: key.includes('RATE') ? 'percent' : 'CZK/m2',
  period: new Date(period),
  observedAt: new Date(period),
  ...(location ? { location } : {}),
});

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

describe('monthly reality report', () => {
  it('shows rate changes in percentage points and standardized stress cashflow', () => {
    const text = renderRealityReport(
      {
        generatedAt: new Date('2026-10-05T10:00:00Z'),
        marketScore: 63,
        verdict: 'Select opportunities.',
        metrics: [
          metric('rate-oct', 'REALIZED_MORTGAGE_RATE', 4.82, '2026-10-01'),
          metric('rate-sep', 'REALIZED_MORTGAGE_RATE', 4.7, '2026-09-01'),
          metric(
            'price-ostrava',
            'MEDIAN_ASK_PRICE_PER_M2',
            55_000,
            '2026-10-01',
            'Ostrava',
          ),
          {
            ...metric(
              'rent-ostrava',
              'RENT_PER_M2',
              264,
              '2026-10-01',
              'Ostrava',
            ),
            category: 'RENTS',
          },
        ],
        opportunities: [],
        sourceFailures: [],
      },
      ['Ostrava'],
      model,
    );

    expect(text).toContain('REALITY MARKET — ŘÍJEN 2026');
    expect(text).toContain('+0,12 p. b. MoM');
    expect(text).toContain('Hypotéka × nájem');
    expect(text).toContain('7,00 %');
  });
});
