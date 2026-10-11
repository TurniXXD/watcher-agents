import { describe, expect, it, vi } from 'vitest';
import {
  DiscoveryScreeningClient,
  assessDiscoveryScreening,
  calculateRsi14,
  screenedDiscoveryCandidate,
} from '../discovery-screening.js';

const policy = { oversoldRsiThreshold: 30, maximumForwardPe: 15 };

describe('discovery value and oversold screening', () => {
  it('calculates RSI(14) only with a complete positive close window', () => {
    expect(calculateRsi14(Array.from({ length: 14 }, () => 10))).toBeNull();
    expect(
      calculateRsi14([
        30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16,
      ]),
    ).toBe(0);
    expect(calculateRsi14(Array.from({ length: 15 }, () => 10))).toBe(50);
  });

  it('requires both a bounded positive forward P/E and favorable analyst rank for value', () => {
    expect(
      assessDiscoveryScreening(
        {
          closes: Array.from({ length: 15 }, () => 10),
          forwardPe: '12.5',
          analystRank: '2',
          analystRankText: 'Buy',
        },
        policy,
      ),
    ).toMatchObject({
      signals: ['UNDERVALUED'],
      primaryTrigger: 'UNDERVALUED',
      forwardPe: 12.5,
      analystRank: 2,
    });
    expect(
      assessDiscoveryScreening(
        {
          closes: [],
          forwardPe: '-4',
          analystRank: '1',
          analystRankText: 'Strong Buy',
        },
        policy,
      ).signals,
    ).toEqual([]);
  });

  it('retains both signals while persisting oversold as the primary trigger', () => {
    const assessment = assessDiscoveryScreening(
      {
        closes: [30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16],
        forwardPe: '10',
        analystRank: '1',
        analystRankText: 'Strong Buy',
      },
      policy,
    );
    expect(assessment.signals).toEqual(['OVERSOLD', 'UNDERVALUED']);
    expect(assessment.reason).toContain('RSI(14)');
    expect(assessment.reason).toContain('forward P/E');
    expect(
      screenedDiscoveryCandidate(
        {
          ticker: 'TEST',
          price: 16,
          changePercent: -4,
          volume: 1_000_000,
          observedAt: new Date('2026-10-10T00:00:00Z'),
          source: 'TEST',
          trigger: 'PRICE_MOVE',
          dollarVolume: 16_000_000,
          attentionScore: 65,
          reason: 'move',
          fingerprint: 'base',
          screeningSignals: [],
        },
        assessment,
      ),
    ).toMatchObject({
      trigger: 'PRICE_MOVE',
      screeningSignals: ['OVERSOLD', 'UNDERVALUED'],
      attentionScore: 95,
    });
  });

  it('isolates provider failures and still uses available technical data', async () => {
    const client = new DiscoveryScreeningClient(
      {
        getDailyHistory: vi.fn().mockResolvedValue(
          [30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16].map(
            (close, index) => ({
              date: `2026-09-${String(index + 1).padStart(2, '0')}`,
              open: close,
              high: close,
              low: close,
              close,
              volume: 1_000_000,
            }),
          ),
        ),
      },
      { getSnapshot: vi.fn().mockRejectedValue(new Error('unavailable')) },
      policy,
    );

    await expect(client.assess('TEST')).resolves.toMatchObject({
      signals: ['OVERSOLD'],
      sourceFailures: ['Zacks valuation: unavailable'],
    });
  });
});
