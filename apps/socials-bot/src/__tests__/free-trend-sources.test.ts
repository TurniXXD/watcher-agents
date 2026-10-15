import { assertPublicHttpUrl } from '@watcher/core';
import { describe, expect, it, vi } from 'vitest';
import { BlueskyTrendSource } from '../trends/bluesky-source.js';
import { HackerNewsTrendSource } from '../trends/hacker-news-source.js';
import { fetchWithTrendRetry } from '../trends/http.js';
import { MastodonTrendSource } from '../trends/mastodon-source.js';
import { parseTrendFeed, RssTrendSource } from '../trends/rss-source.js';

const context = {
  keywords: ['AI automation'],
  subreddits: [],
  youtubeChannelIds: [],
  regions: ['US', 'CZ'] as const,
  now: new Date('2026-10-14T05:00:00.000Z'),
};

const publicResolver = async (value: string): Promise<URL> =>
  assertPublicHttpUrl(value);

const requestUrl = (input: string | URL | Request): string =>
  input instanceof Request
    ? input.url
    : input instanceof URL
      ? input.toString()
      : input;

describe('free trend source adapters', () => {
  it('normalizes and paginates public Bluesky posts', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      expect(requestUrl(input)).toContain('app.bsky.feed.searchPosts');
      return new Response(
        JSON.stringify({
          posts: [
            {
              uri: 'at://did:plc:test/app.bsky.feed.post/abc',
              author: {
                did: 'did:plc:test',
                handle: 'alice.example',
                displayName: 'Alice',
              },
              record: {
                text: 'AI automation is becoming useful',
                createdAt: '2026-10-14T04:00:00.000Z',
                tags: ['ai'],
              },
              indexedAt: '2026-10-14T04:01:00.000Z',
              likeCount: 12,
              repostCount: 4,
              replyCount: 3,
              quoteCount: 2,
            },
          ],
        }),
      );
    });
    const result = await new BlueskyTrendSource({
      keywords: ['AI automation'],
      maxPosts: 10,
      fetch: fetcher,
    }).collect({ ...context, keywords: [] });
    expect(result.availability).toBe('ACTIVE');
    expect(result.signals[0]).toMatchObject({
      source: 'BLUESKY',
      author: 'Alice',
      metrics: { likes: 12, shares: 4, comments: 3 },
      keywords: ['AI automation', 'ai'],
    });
    expect(result.signals[0]?.metadata?.quoteCount).toBe(2);
  });

  it('filters Hacker News stories, skips dead items, and caches item reads', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(requestUrl(input));
      if (url.pathname.endsWith('/topstories.json')) {
        return new Response(JSON.stringify([1, 2]));
      }
      const id = Number(url.pathname.match(/item\/(\d+)/u)?.[1]);
      return new Response(
        JSON.stringify(
          id === 1
            ? {
                id,
                type: 'story',
                by: 'hn-user',
                time: 1_797_214_400,
                title: 'AI automation for teams',
                url: 'https://example.com/ai',
                score: 42,
                descendants: 9,
              }
            : { id, type: 'story', dead: true, title: 'dead' },
        ),
      );
    });
    const source = new HackerNewsTrendSource({
      categories: ['top'],
      maxStories: 10,
      fetch: fetcher,
    });
    const first = await source.collect(context);
    const second = await source.collect(context);
    expect(first.signals).toHaveLength(1);
    expect(first.signals[0]).toMatchObject({
      source: 'HACKERNEWS',
      author: 'hn-user',
      metrics: { likes: 42, comments: 9 },
    });
    expect(second.signals).toHaveLength(1);
    expect(
      fetcher.mock.calls.filter(([input]) =>
        requestUrl(input).includes('/item/'),
      ),
    ).toHaveLength(2);
  });

  it('normalizes Mastodon HTML and marks restricted trend endpoints unavailable', async () => {
    const normalized = await new MastodonTrendSource({
      instances: ['https://mastodon.example'],
      trendTypes: ['statuses'],
      fetch: vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              {
                id: 'status-1',
                created_at: '2026-10-14T04:00:00.000Z',
                content:
                  '<p>AI <strong>automation</strong></p><script>bad()</script>',
                url: 'https://mastodon.example/@alice/1',
                uri: 'https://mastodon.example/users/alice/statuses/1',
                replies_count: 2,
                reblogs_count: 3,
                favourites_count: 5,
                account: {
                  acct: 'alice',
                  display_name: 'Alice',
                  url: 'https://mastodon.example/@alice',
                },
                tags: [{ name: 'ai' }],
              },
            ]),
          ),
      ),
    }).collect(context);
    expect(normalized.signals[0]?.description).toBe('AI automation');
    expect(normalized.signals[0]?.metrics).toEqual({
      likes: 5,
      comments: 2,
      shares: 3,
    });

    const restricted = await new MastodonTrendSource({
      instances: ['https://restricted.example'],
      trendTypes: ['statuses'],
      fetch: vi.fn(async () => new Response('forbidden', { status: 403 })),
    }).collect(context);
    expect(restricted).toMatchObject({
      availability: 'UNAVAILABLE',
      signals: [],
    });
  });

  it('parses RSS and Atom without fabricating engagement metrics', () => {
    const rss = parseTrendFeed({
      xml: '<rss><channel><title>Example</title><item><guid>one</guid><title>AI &amp; automation</title><link>https://example.com/one</link><description><![CDATA[<p>Useful <b>details</b></p>]]></description><author>Alice</author><pubDate>Wed, 14 Oct 2026 04:00:00 GMT</pubDate><category>AI</category></item></channel></rss>',
      feedUrl: 'https://example.com/rss',
      now: context.now,
      maxItems: 10,
    });
    const atom = parseTrendFeed({
      xml: '<feed><title>Atom</title><entry><id>tag:example,1</id><title>Local automation</title><link rel="alternate" href="https://example.com/atom"/><summary>Summary</summary><author><name>Bob</name></author><updated>2026-10-14T04:00:00Z</updated></entry></feed>',
      feedUrl: 'https://example.com/atom.xml',
      now: context.now,
      maxItems: 10,
    });
    expect(rss[0]).toMatchObject({
      author: 'Alice',
      description: 'Useful details',
      metrics: {},
      keywords: ['AI'],
    });
    expect(atom[0]).toMatchObject({ author: 'Bob', metrics: {} });
  });

  it('uses conditional feed requests and rejects redirects to private hosts', async () => {
    const fetcher = vi
      .fn(async (input: string | URL | Request, init?: RequestInit) => {
        void input;
        void init;
        return new Response('unconfigured');
      })
      .mockResolvedValueOnce(
        new Response(
          '<rss><channel><item><guid>1</guid><title>AI automation</title><link>https://example.com/one</link></item></channel></rss>',
          { headers: { etag: '"v1"' } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const source = new RssTrendSource({
      feeds: ['https://example.com/feed'],
      fetch: fetcher,
      resolvePublicUrl: publicResolver,
    });
    expect((await source.collect(context)).signals).toHaveLength(1);
    expect((await source.collect(context)).signals).toHaveLength(1);
    const secondHeaders = new Headers(fetcher.mock.calls[1]?.[1]?.headers);
    expect(secondHeaders.get('if-none-match')).toBe('"v1"');

    const redirecting = new RssTrendSource({
      feeds: ['https://example.com/feed'],
      fetch: vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: 'http://127.0.0.1/private' },
          }),
      ),
      resolvePublicUrl: publicResolver,
    });
    await expect(redirecting.collect(context)).resolves.toMatchObject({
      availability: 'ERROR',
      signals: [],
    });
  });

  it('retries HTTP 429 using Retry-After', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('slow down', {
          status: 429,
          headers: { 'retry-after': '0' },
        }),
      )
      .mockResolvedValueOnce(new Response('ok'));
    const sleep = vi.fn(async () => undefined);
    await expect(
      fetchWithTrendRetry('https://example.com', {}, { fetch: fetcher, sleep }),
    ).resolves.toBeInstanceOf(Response);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(0);
  });
});
