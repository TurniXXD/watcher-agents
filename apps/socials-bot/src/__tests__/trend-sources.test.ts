import { describe, expect, it, vi } from 'vitest';
import { RedditTrendSource, YouTubeTrendSource } from '../trends/sources.js';

const context = {
  keywords: ['AI automation'],
  subreddits: ['artificial'],
  youtubeChannelIds: [],
  regions: ['US', 'CZ'] as const,
  now: new Date('2026-10-14T05:00:00.000Z'),
};

describe('trend source adapters', () => {
  it('marks missing credentials without making requests', async () => {
    const youtube = new YouTubeTrendSource({});
    const reddit = new RedditTrendSource({});
    await expect(youtube.collect(context)).resolves.toMatchObject({
      availability: 'CREDENTIALS_REQUIRED',
      signals: [],
    });
    await expect(reddit.collect(context)).resolves.toMatchObject({
      availability: 'CREDENTIALS_REQUIRED',
      signals: [],
    });
  });

  it('normalizes US and Czech YouTube evidence and caches identical requests', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url =
        input instanceof Request
          ? new URL(input.url)
          : input instanceof URL
            ? input
            : new URL(input);
      if (url.pathname.endsWith('/search')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: { videoId: 'video-1' },
                snippet: {
                  title: 'AI automation for small business',
                  description: 'A practical workflow',
                  publishedAt: '2026-10-13T05:00:00Z',
                  channelId: 'channel-1',
                  channelTitle: 'Example',
                },
              },
            ],
          }),
        );
      }
      return new Response(
        JSON.stringify({
          items: [
            {
              id: 'video-1',
              snippet: {
                title: 'AI automation for small business',
                description: 'A practical workflow',
                publishedAt: '2026-10-13T05:00:00Z',
                channelId: 'channel-1',
                channelTitle: 'Example',
              },
              statistics: {
                viewCount: '1000',
                likeCount: '50',
                commentCount: '7',
              },
              contentDetails: { duration: 'PT45S' },
            },
          ],
        }),
      );
    });
    const source = new YouTubeTrendSource({ apiKey: 'test', fetch: fetcher });
    const first = await source.collect(context);
    const calls = fetcher.mock.calls.length;
    const second = await source.collect(context);
    expect(first.signals.map(({ region }) => region).sort()).toEqual([
      'CZ',
      'US',
    ]);
    expect(first.signals[0]?.metrics.views).toBe(1_000);
    expect(first.signals[0]?.metadata?.shortFormCandidate).toBe(true);
    expect(second.signals).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(calls);
  });

  it('isolates API failures and reports exhausted configured quota', async () => {
    const failed = new YouTubeTrendSource({
      apiKey: 'test',
      fetch: vi.fn(async () => new Response('forbidden', { status: 403 })),
    });
    await expect(failed.collect(context)).resolves.toMatchObject({
      availability: 'ERROR',
      signals: [],
    });
    const exhausted = new YouTubeTrendSource({
      apiKey: 'test',
      maxSearchesPerRun: 0,
    });
    await expect(exhausted.collect(context)).resolves.toMatchObject({
      availability: 'QUOTA_EXHAUSTED',
      quotaUsed: 0,
    });
  });
});
