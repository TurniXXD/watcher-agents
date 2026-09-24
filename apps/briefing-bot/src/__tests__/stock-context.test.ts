import type { EarningsReminderCandidate } from '@watcher/database';
import { describe, expect, it, vi } from 'vitest';
import {
  loadWatchlistEarnings,
  upcomingWatchlistEarnings,
} from '../stock-context.js';

const candidate = (
  ticker: string,
  expectedStart: string,
  overrides: Partial<EarningsReminderCandidate> = {},
): EarningsReminderCandidate => ({
  id: `${ticker}:${expectedStart}`,
  ticker,
  companyName: ticker === 'MU' ? 'Micron Technology' : null,
  description: 'Confirmed quarterly earnings report',
  expectedStart: new Date(expectedStart),
  exactDateKnown: true,
  impact: 'HIGH',
  source: 'COMPANY',
  sourceUrl: `https://example.com/${ticker}`,
  ...overrides,
});

describe('watchlist earnings context', () => {
  it('includes confirmed watched earnings through local day 14 and deduplicates ticker/day', () => {
    const events = upcomingWatchlistEarnings(
      [
        candidate('MU', '2026-09-23T21:30:00Z'),
        candidate('MU', '2026-09-23T21:30:00Z', { id: 'duplicate' }),
        candidate('SNDK', '2026-10-07T10:00:00Z'),
        candidate('LATE', '2026-10-08T10:00:00Z'),
        candidate('PAST', '2026-09-22T10:00:00Z'),
        candidate('UNKNOWN', '2026-09-26T10:00:00Z', {
          exactDateKnown: false,
        }),
      ],
      new Date('2026-09-23T07:00:00Z'),
      'Europe/Prague',
    );

    expect(events.map(({ ticker, daysUntil }) => [ticker, daysUntil])).toEqual([
      ['MU', 0],
      ['SNDK', 14],
    ]);
    expect(events[0]).toMatchObject({
      date: '2026-09-23',
      dateLabel: 'Sep 23',
      sourceUrl: 'https://example.com/MU',
    });
  });

  it('queries the exact 14-day local-date window and reports source failure', async () => {
    const now = new Date('2026-09-23T07:00:00Z');
    const list = vi.fn(
      async (
        _telegramChatId: bigint,
        _window: { from: Date; through: Date },
      ) => {
        void _telegramChatId;
        void _window;
        return [candidate('MU', '2026-09-30T20:00:00Z')];
      },
    );

    await expect(
      loadWatchlistEarnings({ list }, 123n, now, 'Europe/Prague'),
    ).resolves.toMatchObject({
      status: 'AVAILABLE',
      events: [{ ticker: 'MU', daysUntil: 7 }],
    });
    expect(list).toHaveBeenCalledOnce();
    expect(list.mock.calls[0]?.[0]).toBe(123n);
    const window = list.mock.calls[0]?.[1];
    expect(window?.from.toISOString()).toBe('2026-09-22T22:00:00.000Z');
    expect(window?.through.toISOString()).toBe('2026-10-07T22:00:00.000Z');

    await expect(
      loadWatchlistEarnings(
        { list: async () => Promise.reject(new Error('database unavailable')) },
        123n,
        now,
        'Europe/Prague',
      ),
    ).resolves.toEqual({ status: 'UNAVAILABLE', events: [] });
  });
});
