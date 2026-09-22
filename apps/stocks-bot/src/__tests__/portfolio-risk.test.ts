import { describe, expect, it } from 'vitest';
import { assessPortfolioRisk, renderPortfolioRisk } from '../portfolio-risk.js';

const position = (ticker: string, amountCzk: number) => ({
  id: ticker,
  ticker,
  status: 'OPEN' as const,
  openedAt: new Date('2026-09-20T08:00:00Z'),
  closedAt: null,
  horizonDays: 30,
  amountCzk,
  entryPrice: 100,
  entryPriceObservedAt: new Date('2026-09-20T08:00:00Z'),
  exitPrice: null,
  exitPriceObservedAt: null,
  latestPrice: 105,
  latestPriceObservedAt: new Date('2026-09-21T08:00:00Z'),
  returnPercent: 5,
  notionalProfitCzk: amountCzk * 0.05,
  horizonElapsed: false,
  thesis: { verdict: 'WATCH', confidence: 0.6, attentionScore: 70 },
});

describe('portfolio risk', () => {
  it('flags concentrated same-sector paper positions with incomplete research', () => {
    const snapshot = assessPortfolioRisk(
      [position('MU', 80_000), position('SNDK', 20_000)],
      [
        {
          stock: { symbol: 'MU', sector: 'Semiconductors' },
          thesis: { confidence: 0.7, dataCoverage: 80 },
        },
        {
          stock: { symbol: 'SNDK', sector: 'Semiconductors' },
          thesis: { confidence: 0.4, dataCoverage: 40 },
        },
      ],
      new Date('2026-09-21T12:00:00Z'),
    );

    expect(snapshot.positions[0]).toMatchObject({
      ticker: 'MU',
      weightPercent: 80,
    });
    expect(snapshot.sectorConcentration).toEqual([
      { sector: 'Semiconductors', weightPercent: 100 },
    ]);
    expect(snapshot.warnings.map(({ message }) => message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('MU is 80%'),
        expect.stringContaining('Semiconductors represents 100%'),
        expect.stringContaining('SNDK has incomplete'),
      ]),
    );
    expect(renderPortfolioRisk(snapshot)).toContain('PORTFOLIO RISK');
    expect(renderPortfolioRisk(snapshot)).toContain('HHI 0.68');
  });
});
