import { afterEach, describe, expect, it, vi } from 'vitest';

const required = {
  DATABASE_URL: 'postgresql://watcher:watcher@localhost:5432/watcher',
  SOCIALS_TELEGRAM_TOKEN: 'test-token',
  TELEGRAM_ALLOWED_USER_IDS: '1',
};

describe('social trend environment', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('accepts the free providers and parses provider lists', async () => {
    for (const [key, value] of Object.entries(required)) {
      vi.stubEnv(key, value);
    }
    const { parseSocialsEnvironment } = await import('../env.js');
    const parsed = parseSocialsEnvironment({
      ...required,
      SOCIALS_TREND_SOURCES: 'YOUTUBE,BLUESKY,HACKERNEWS,MASTODON,RSS',
      SOCIALS_BLUESKY_KEYWORDS: 'AI agents, local AI',
      SOCIALS_HACKERNEWS_CATEGORIES: 'top,new',
      SOCIALS_MASTODON_TREND_TYPES: 'tags,links',
      SOCIALS_RSS_FEEDS: 'https://example.com/feed.xml',
    });
    expect(parsed.SOCIALS_TREND_SOURCES).toEqual([
      'YOUTUBE',
      'BLUESKY',
      'HACKERNEWS',
      'MASTODON',
      'RSS',
    ]);
    expect(parsed.SOCIALS_HACKERNEWS_CATEGORIES).toEqual(['top', 'new']);
    expect(parsed.SOCIALS_RSS_FEEDS).toEqual(['https://example.com/feed.xml']);
  });

  it('rejects unknown providers and invalid provider categories', async () => {
    for (const [key, value] of Object.entries(required)) {
      vi.stubEnv(key, value);
    }
    const { parseSocialsEnvironment } = await import('../env.js');
    expect(() =>
      parseSocialsEnvironment({
        ...required,
        SOCIALS_TREND_SOURCES: 'YOUTUBE,UNKNOWN',
      }),
    ).toThrow('Unsupported trend source');
    expect(() =>
      parseSocialsEnvironment({
        ...required,
        SOCIALS_HACKERNEWS_CATEGORIES: 'top,viral',
      }),
    ).toThrow();
  });
});
