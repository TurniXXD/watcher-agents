import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabaseClient } from '../client.js';
import { JournalSessionStore } from '../journal-session-store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('JournalSessionStore with PostgreSQL', () => {
  if (!databaseUrl) return;

  const database = createDatabaseClient(databaseUrl);
  const store = new JournalSessionStore(database);

  beforeEach(async () => {
    await database.journalSession.deleteMany();
    await database.briefingSettings.deleteMany();
  });

  afterAll(async () => database.$disconnect());

  it('enforces one restart-safe session per chat, user, and journal date', async () => {
    const at = new Date('2026-10-12T19:00:00.000Z');
    const first = await store.ensure(801n, 801n, '2026-10-12', at);
    const second = await store.ensure(801n, 801n, '2026-10-12', at);
    const started = await store.start(first.id, 'TEXT');
    const saved = await store.saveProgress(
      started.id,
      { ...started.answers, experienced: 'Dokončil jsem návrh.' },
      1,
      'IN_PROGRESS',
    );

    expect(second.id).toBe(first.id);
    expect(await database.journalSession.count()).toBe(1);
    expect((await store.getLatest(801n, 801n))?.answers.experienced).toBe(
      'Dokončil jsem návrh.',
    );
    expect(saved.currentQuestion).toBe(1);
  });

  it('isolates sessions by Telegram user', async () => {
    const at = new Date('2026-10-12T19:00:00.000Z');
    const first = await store.ensure(900n, 901n, '2026-10-12', at);
    const second = await store.ensure(900n, 902n, '2026-10-12', at);

    expect(first.id).not.toBe(second.id);
    expect(await store.getById(first.id, 900n, 902n)).toBeUndefined();
  });

  it('finds an active previous-day interaction after the next daily session exists', async () => {
    const chatId = 950n;
    const previous = await store.ensure(
      chatId,
      chatId,
      '2026-10-22',
      new Date('2026-10-22T19:00:00.000Z'),
    );
    await store.start(previous.id, 'TEXT');
    const next = await store.ensure(
      chatId,
      chatId,
      '2026-10-23',
      new Date('2026-10-23T19:00:00.000Z'),
    );

    expect((await store.getLatest(chatId, chatId))?.id).toBe(next.id);
    expect((await store.getActiveInteraction(chatId, chatId))?.id).toBe(
      previous.id,
    );
  });
});
