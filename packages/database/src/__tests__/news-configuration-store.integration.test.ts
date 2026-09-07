import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabaseClient } from '../client.js';
import { NewsConfigurationStore } from '../news-configuration-store.js';
import { WatcherStore } from '../store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('news configuration with PostgreSQL', () => {
  if (!databaseUrl) return;
  const database = createDatabaseClient(databaseUrl);
  const news = new NewsConfigurationStore(database);
  const watcher = new WatcherStore(database);

  beforeEach(async () => {
    await database.telegramChat.deleteMany();
  });

  afterAll(async () => {
    await database.$disconnect();
  });

  it('persists separate Czech and Global feeds and topics', async () => {
    const chat = await watcher.ensureChat('NEWS', 701n);
    const czech = await news.addFeed(
      chat.id,
      'CZECH',
      'https://example.cz/rss',
      'Example CZ',
    );
    await news.addFeed(
      chat.id,
      'GLOBAL',
      'https://example.com/rss',
      'Example Global',
    );
    await news.addTopic(chat.id, 'CZECH', 'energetika');
    await news.addTopic(chat.id, 'GLOBAL', 'artificial intelligence');

    expect(await news.listFeeds(chat.id)).toMatchObject([
      { scope: 'CZECH', name: 'Example CZ', enabled: true },
      { scope: 'GLOBAL', name: 'Example Global', enabled: true },
    ]);
    expect(await news.listTopics(chat.id)).toMatchObject([
      { scope: 'CZECH', topic: 'energetika' },
      { scope: 'GLOBAL', topic: 'artificial intelligence' },
    ]);

    expect(await news.setFeedEnabled(chat.id, czech.id, false)).toBe(true);
    expect(await news.removeFeed(chat.id, czech.id)).toBe(true);
    expect(await news.removeTopic(chat.id, 'CZECH', 'energetika')).toBe(true);
  });

  it('rejects private feed URLs', async () => {
    const chat = await watcher.ensureChat('NEWS', 702n);
    await expect(
      news.addFeed(chat.id, 'CZECH', 'http://127.0.0.1/feed', 'Private'),
    ).rejects.toThrow(/Private or special-purpose/);
  });
});
