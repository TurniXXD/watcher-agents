import { describe, expect, it, vi } from 'vitest';
import type { EnqueueTelegramOutboxMessage } from '@watcher/database';
import {
  enqueueTrading212Positions,
  trading212SlotAt,
} from '../trading212-schedule.js';

const portfolio = {
  account: {
    currency: 'CZK',
    totalValue: 100,
    cash: { availableToTrade: 50, inPies: 0, reservedForOrders: 0 },
    investments: {
      currentValue: 50,
      totalCost: 40,
      unrealizedProfitLoss: 10,
      realizedProfitLoss: 0,
    },
  },
  positions: [],
  asOf: new Date('2026-09-29T13:25:00Z'),
  environment: 'LIVE' as const,
};

describe('Trading 212 scheduled positions', () => {
  it('uses the NYSE close in New York local time across daylight-saving changes', () => {
    expect(trading212SlotAt(new Date('2026-09-29T20:05:00Z'))).toEqual({
      date: '2026-09-29',
      name: 'close',
      closeTime: '16:00',
    });
    expect(trading212SlotAt(new Date('2026-12-01T21:05:00Z'))).toEqual({
      date: '2026-12-01',
      name: 'close',
      closeTime: '16:00',
    });
    expect(trading212SlotAt(new Date('2026-09-29T20:04:00Z'))).toBeUndefined();
    expect(trading212SlotAt(new Date('2026-09-26T20:05:00Z'))).toBeUndefined();
    expect(trading212SlotAt(new Date('2026-09-29T22:30:00Z'))).toEqual({
      date: '2026-09-29',
      name: 'close',
      closeTime: '16:00',
    });
  });

  it('skips NYSE holidays and runs after the actual close on shortened sessions', () => {
    for (const holiday of [
      '2026-01-01T21:05:00Z',
      '2026-01-19T21:05:00Z',
      '2026-02-16T21:05:00Z',
      '2026-04-03T20:05:00Z',
      '2026-05-25T20:05:00Z',
      '2026-06-19T20:05:00Z',
      '2026-07-03T20:05:00Z',
      '2026-09-07T20:05:00Z',
      '2026-11-26T21:05:00Z',
      '2026-12-25T21:05:00Z',
      '2027-06-18T20:05:00Z',
      '2027-07-05T20:05:00Z',
      '2027-12-24T21:05:00Z',
    ]) {
      expect(trading212SlotAt(new Date(holiday)), holiday).toBeUndefined();
    }

    expect(trading212SlotAt(new Date('2026-11-27T18:05:00Z'))).toEqual({
      date: '2026-11-27',
      name: 'close',
      closeTime: '13:00',
    });
    expect(trading212SlotAt(new Date('2026-11-27T21:05:00Z'))).toEqual({
      date: '2026-11-27',
      name: 'close',
      closeTime: '13:00',
    });
    expect(trading212SlotAt(new Date('2026-12-24T18:05:00Z'))).toEqual({
      date: '2026-12-24',
      name: 'close',
      closeTime: '13:00',
    });
    expect(trading212SlotAt(new Date('2027-07-02T17:05:00Z'))).toBeUndefined();
    expect(trading212SlotAt(new Date('2027-07-02T20:05:00Z'))).toEqual({
      date: '2027-07-02',
      name: 'close',
      closeTime: '16:00',
    });
    expect(trading212SlotAt(new Date('2028-07-03T17:05:00Z'))).toEqual({
      date: '2028-07-03',
      name: 'close',
      closeTime: '13:00',
    });
  });

  it('requires opt-in and queues the same positions view with a stable slot key', async () => {
    const enabled = vi.fn().mockResolvedValue(false);
    const getPortfolio = vi.fn().mockResolvedValue(portfolio);
    const queued: EnqueueTelegramOutboxMessage[] = [];
    const enqueue = vi.fn(async (message: EnqueueTelegramOutboxMessage) => {
      queued.push(message);
    });
    const now = new Date('2026-09-29T20:05:00Z');

    expect(
      await enqueueTrading212Positions(
        now,
        123n,
        { enabled },
        { getPortfolio },
        { enqueue },
      ),
    ).toBe(false);
    expect(getPortfolio).not.toHaveBeenCalled();

    enabled.mockResolvedValue(true);
    expect(
      await enqueueTrading212Positions(
        now,
        123n,
        { enabled },
        { getPortfolio },
        { enqueue },
      ),
    ).toBe(true);
    expect(queued[0]?.deduplicationKey).toBe('123:2026-09-29:close:0');
    expect(queued[0]?.chatId).toBe(123n);
    expect(queued[0]?.body).toContain('po zavření trhu');
    expect(queued[0]?.body).toContain('Otevřené pozice (0)');
  });
});
