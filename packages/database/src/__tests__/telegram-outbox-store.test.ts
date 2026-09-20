import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient } from '../client.js';
import { TelegramOutboxStore } from '../telegram-outbox-store.js';

describe('TelegramOutboxStore', () => {
  it('deduplicates an enqueued scheduled notification', async () => {
    const upsert = vi.fn(async () => ({}));
    const database = {
      telegramOutboxMessage: { upsert },
    } as unknown as DatabaseClient;

    await new TelegramOutboxStore(database).enqueue({
      kind: 'STOCK_DISCOVERY_REPORT',
      deduplicationKey: 'scan-1',
      chatId: 42n,
      body: 'Weekly report',
    });

    expect(upsert).toHaveBeenCalledWith({
      where: {
        kind_deduplicationKey: {
          kind: 'STOCK_DISCOVERY_REPORT',
          deduplicationKey: 'scan-1',
        },
      },
      create: {
        kind: 'STOCK_DISCOVERY_REPORT',
        deduplicationKey: 'scan-1',
        telegramChatId: 42n,
        body: 'Weekly report',
      },
      update: {},
    });
  });

  it('claims only still-due work and assigns a delivery lease', async () => {
    const now = new Date('2026-09-19T12:00:00Z');
    const updateCalls: Array<{
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }> = [];
    const updateMany = vi.fn(async (input: (typeof updateCalls)[number]) => {
      updateCalls.push(input);
      return { count: 1 };
    });
    const findUniqueOrThrow = vi.fn(async () => ({
      id: 'outbox-1',
      kind: 'STOCK_DISCOVERY_REPORT',
      deduplicationKey: 'scan-1',
      telegramChatId: 42n,
      body: 'Weekly report',
      attemptCount: 2,
      leaseToken: 'lease-token',
    }));
    const transaction = {
      telegramOutboxMessage: { updateMany, findUniqueOrThrow },
    };
    const database = {
      telegramOutboxMessage: {
        findMany: vi.fn(async () => [{ id: 'outbox-1', status: 'PENDING' }]),
      },
      $transaction: vi.fn(
        async (callback: (value: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as DatabaseClient;

    const messages = await new TelegramOutboxStore(database).claimDue(
      now,
      10,
      60_000,
    );

    expect(messages).toEqual([
      expect.objectContaining({
        id: 'outbox-1',
        chatId: 42n,
        attemptCount: 2,
        leaseToken: 'lease-token',
      }),
    ]);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.where).toMatchObject({
      id: 'outbox-1',
      status: 'PENDING',
      nextAttemptAt: { lte: now },
    });
    expect(updateCalls[0]?.data).toMatchObject({
      status: 'SENDING',
      attemptCount: { increment: 1 },
      leaseExpiresAt: new Date('2026-09-19T12:01:00Z'),
    });
  });

  it('moves retryable failures back to pending and terminal failures to dead letter', async () => {
    const updateCalls: Array<{
      data: { status: string; nextAttemptAt: Date };
    }> = [];
    const updateMany = vi.fn(async (input: (typeof updateCalls)[number]) => {
      updateCalls.push(input);
      return { count: 1 };
    });
    const database = {
      telegramOutboxMessage: { updateMany },
    } as unknown as DatabaseClient;
    const store = new TelegramOutboxStore(database);
    const message = {
      id: 'outbox-1',
      kind: 'STOCK_DISCOVERY_REPORT',
      deduplicationKey: 'scan-1',
      chatId: 42n,
      body: 'Weekly report',
      attemptCount: 1,
      leaseToken: 'lease-token',
    };
    const retryAt = new Date('2026-09-19T12:01:00Z');

    await store.markFailed(message, 'Telegram unavailable', retryAt);
    await store.markFailed(message, 'Still unavailable');

    expect(updateCalls[0]?.data).toMatchObject({
      status: 'PENDING',
      nextAttemptAt: retryAt,
    });
    expect(updateCalls[1]?.data.status).toBe('DEAD_LETTER');
  });
});
