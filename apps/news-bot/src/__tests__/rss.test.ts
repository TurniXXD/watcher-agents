import { afterEach, describe, expect, it, vi } from 'vitest';
import { RssNewsSource } from '../sources/rss.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('RssNewsSource', () => {
  it('normalizes RSS items and preserves their profile context', async () => {
    const fetcher = vi.fn(async () =>
      Promise.resolve(
        new Response(`
          <rss version="2.0"><channel><item>
            <title>Czech energy policy changes</title>
            <link>https://news.example/articles/energy</link>
            <description><![CDATA[<p>The government announced a new energy policy.</p>]]></description>
            <pubDate>Sun, 06 Sep 2026 08:00:00 GMT</pubDate>
          </item></channel></rss>
        `),
      ),
    );
    const source = new RssNewsSource(fetcher, async (url) => new URL(url));

    await expect(
      source.fetch({
        feedUrl: 'https://news.example/rss',
        feedName: 'Example News',
        scope: 'CZECH',
        topics: ['energy'],
      }),
    ).resolves.toMatchObject([
      {
        source: 'NEWS_RSS_CZECH',
        externalId: 'https://news.example/articles/energy',
        title: 'Czech energy policy changes',
        content: 'The government announced a new energy policy.',
        metadata: {
          scope: 'CZECH',
          topics: ['energy'],
          feedName: 'Example News',
        },
      },
    ]);
  });

  it('validates every redirect destination against SSRF', async () => {
    const fetcher = vi.fn(async () =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1/private' },
        }),
      ),
    );
    const resolvePublicUrl = vi.fn(async (url: string) => {
      if (url.includes('127.0.0.1')) throw new Error('private target');
      return new URL(url);
    });
    const source = new RssNewsSource(fetcher, resolvePublicUrl);

    await expect(
      source.fetch({
        feedUrl: 'https://news.example/rss',
        feedName: 'Example News',
        scope: 'GLOBAL',
        topics: [],
      }),
    ).rejects.toThrow('private target');
    expect(resolvePublicUrl).toHaveBeenCalledTimes(2);
  });

  it('retries a temporary DNS lookup failure before failing the feed', async () => {
    vi.useFakeTimers();
    const dnsError = Object.assign(new Error('lookup temporarily failed'), {
      code: 'EAI_AGAIN',
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('fetch failed', { cause: dnsError }))
      .mockResolvedValueOnce(
        new Response(
          '<rss><channel><item><title>Recovered</title><link>https://news.example/recovered</link></item></channel></rss>',
        ),
      );
    const source = new RssNewsSource(fetcher, async (url) => new URL(url));

    const pending = source.fetch({
      feedUrl: 'https://news.example/rss',
      feedName: 'Example News',
      scope: 'GLOBAL',
      topics: [],
    });
    const assertion = expect(pending).resolves.toMatchObject([
      { title: 'Recovered' },
    ]);
    await vi.advanceTimersByTimeAsync(0);
    await vi.runAllTimersAsync();

    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
