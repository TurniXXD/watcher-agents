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
  it('uses New York local time across daylight-saving changes', () => {
    expect(trading212SlotAt(new Date('2026-09-29T13:25:00Z'))).toEqual({
      date: '2026-09-29',
      name: 'before',
    });
    expect(trading212SlotAt(new Date('2026-12-01T14:35:00Z'))).toEqual({
      date: '2026-12-01',
      name: 'after',
    });
    expect(trading212SlotAt(new Date('2026-09-29T13:31:00Z'))).toBeUndefined();
    expect(trading212SlotAt(new Date('2026-09-26T13:25:00Z'))).toBeUndefined();
  });

  it('requires opt-in and queues the same positions view with a stable slot key', async () => {
    const enabled = vi.fn().mockResolvedValue(false);
    const getPortfolio = vi.fn().mockResolvedValue(portfolio);
    const queued: EnqueueTelegramOutboxMessage[] = [];
    const enqueue = vi.fn(async (message: EnqueueTelegramOutboxMessage) => {
      queued.push(message);
    });
    const now = new Date('2026-09-29T13:25:00Z');

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
    expect(queued[0]?.deduplicationKey).toBe('123:2026-09-29:before:0');
    expect(queued[0]?.chatId).toBe(123n);
    expect(queued[0]?.body).toContain('Otevřené pozice (0)');
  });
});
