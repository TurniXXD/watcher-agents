import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabaseClient } from '../client.js';
import {
  Trading212ScheduleStore,
  trading212ScheduledKind,
} from '../trading212-schedule-store.js';
import { TelegramOutboxStore } from '../telegram-outbox-store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('Trading212ScheduleStore with PostgreSQL', () => {
  if (!databaseUrl) return;

  const database = createDatabaseClient(databaseUrl);
  const schedule = new Trading212ScheduleStore(database);
  const outbox = new TelegramOutboxStore(database);
  const chatId = 9_212_001n;
  const deduplicationKey = `${chatId}:2026-09-29:before:0`;

  beforeAll(async () => {
    await database.telegramOutboxMessage.deleteMany({
      where: { kind: trading212ScheduledKind, deduplicationKey },
    });
    await database.trading212Schedule.deleteMany({ where: { chatId } });
  });

  afterAll(async () => {
    await database.telegramOutboxMessage.deleteMany({
      where: { kind: trading212ScheduledKind, deduplicationKey },
    });
    await database.trading212Schedule.deleteMany({ where: { chatId } });
    await database.$disconnect();
  });

  it('persists opt-in, deduplicates a slot, and cancels pending delivery on opt-out', async () => {
    expect(await schedule.enabled(chatId)).toBe(false);
    await schedule.setEnabled(chatId, true);
    expect(await schedule.enabled(chatId)).toBe(true);

    const message = {
      kind: trading212ScheduledKind,
      deduplicationKey,
      chatId,
      body: 'Trading 212 positions',
    };
    await outbox.enqueue(message);
    await outbox.enqueue(message);
    expect(
      await database.telegramOutboxMessage.count({
        where: { kind: trading212ScheduledKind, deduplicationKey },
      }),
    ).toBe(1);

    await schedule.setEnabled(chatId, false);
    expect(await schedule.enabled(chatId)).toBe(false);
    const queued = await database.telegramOutboxMessage.findUniqueOrThrow({
      where: {
        kind_deduplicationKey: {
          kind: trading212ScheduledKind,
          deduplicationKey,
        },
      },
    });
    expect(queued.status).toBe('DEAD_LETTER');
  });
});
