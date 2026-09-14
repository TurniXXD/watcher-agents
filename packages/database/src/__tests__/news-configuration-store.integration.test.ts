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

  it('accepts Global feeds while keeping the Czech profile disabled', async () => {
    const chat = await watcher.ensureChat('NEWS', 701n);
    await expect(
      news.addFeed(chat.id, 'CZECH', 'https://example.cz/rss', 'Example CZ'),
    ).rejects.toThrow(/Czech news profile is disabled/);
    await news.addFeed(
      chat.id,
      'GLOBAL',
      'https://example.com/rss',
      'Example Global',
    );
    await news.addTopic(chat.id, 'GLOBAL', 'artificial intelligence');

    expect(await news.listFeeds(chat.id)).toMatchObject([
      { scope: 'GLOBAL', name: 'Example Global', enabled: true },
    ]);
    expect(await news.listTopics(chat.id)).toMatchObject([
      { scope: 'GLOBAL', topic: 'artificial intelligence' },
    ]);

    const [global] = await news.listFeeds(chat.id);
    expect(await news.setFeedEnabled(chat.id, global!.id, false)).toBe(true);
    expect(await news.removeFeed(chat.id, global!.id)).toBe('REMOVED');
  });

  it('adds built-in feeds once, preserves switches, and prevents removal', async () => {
    const chat = await watcher.ensureChat('NEWS', 703n);
    const defaults = [
      {
        key: 'czech-example',
        scope: 'CZECH' as const,
        name: 'Example Czech',
        url: 'https://example.cz/rss',
      },
      {
        key: 'global-example',
        scope: 'GLOBAL' as const,
        name: 'Example Global',
        url: 'https://example.com/rss',
      },
    ];

    await news.syncBuiltInFeeds(chat.id, defaults);
    const [czech] = await news.listFeeds(chat.id);
    expect(await news.listFeeds(chat.id)).toHaveLength(2);
    expect(czech).toMatchObject({
      builtInKey: 'czech-example',
      enabled: false,
    });

    expect(await news.setFeedEnabled(chat.id, czech!.id, true)).toBe(false);
    await news.syncBuiltInFeeds(chat.id, defaults);
    expect((await news.listFeeds(chat.id))[0]).toMatchObject({
      builtInKey: 'czech-example',
      enabled: false,
    });
    expect(await news.removeFeed(chat.id, czech!.id)).toBe('BUILT_IN');
    expect(await news.listFeeds(chat.id)).toHaveLength(2);

    await expect(
      news.addFeed(
        chat.id,
        'CZECH',
        'https://example.cz/rss',
        'Attempted rename',
      ),
    ).rejects.toThrow(/Czech news profile is disabled/);
  });

  it('rejects private feed URLs', async () => {
    const chat = await watcher.ensureChat('NEWS', 702n);
    await expect(
      news.addFeed(chat.id, 'GLOBAL', 'http://127.0.0.1/feed', 'Private'),
    ).rejects.toThrow(/Private or special-purpose/);
  });

  it('persists category delivery preferences per profile', async () => {
    const chat = await watcher.ensureChat('NEWS', 704n);
    await news.syncCategoryPreferences(chat.id);

    const preferences = await news.listCategoryPreferences(chat.id);
    expect(preferences).toHaveLength(22);
    expect(preferences).toEqual(
      expect.arrayContaining([
        { scope: 'CZECH', category: 'SPORT', enabled: false },
        { scope: 'GLOBAL', category: 'SPORT', enabled: false },
      ]),
    );

    await news.setCategoryEnabled(chat.id, 'GLOBAL', 'SPORT', true);
    expect(await news.listCategoryPreferences(chat.id)).toEqual(
      expect.arrayContaining([
        { scope: 'GLOBAL', category: 'SPORT', enabled: true },
      ]),
    );
  });
});
