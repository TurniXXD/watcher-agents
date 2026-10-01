import { describe, expect, it, vi } from 'vitest';
import { InvestorRelationsSource } from '../investor-relations.js';

const resolvePublicUrl = vi.fn(async (value: string) => new URL(value));
const requestUrl = (input: RequestInfo | URL): string =>
  typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

describe('InvestorRelationsSource', () => {
  it('does not invent a feed when SEC has no issuer URL', async () => {
    const fetcher = vi.fn();
    const source = new InvestorRelationsSource(fetcher, resolvePublicUrl);

    await expect(source.fetch({ symbol: 'MU' })).resolves.toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('discovers and reads an official RSS feed from the issuer page', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url === 'https://investors.example.com/') {
        return new Response(
          '<html><head><link rel="alternate" type="application/rss+xml" href="/news.rss"></head></html>',
        );
      }
      if (url === 'https://investors.example.com/news.rss') {
        return new Response(`
          <rss><channel><item>
            <guid>release-1</guid>
            <title>Quarterly results released</title>
            <link>https://investors.example.com/releases/1</link>
            <description>Revenue and earnings results.</description>
            <pubDate>Fri, 04 Sep 2026 06:00:00 GMT</pubDate>
          </item></channel></rss>
        `);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const source = new InvestorRelationsSource(fetcher, resolvePublicUrl);

    const [item] = await source.fetch({
      symbol: 'MU',
      investorRelationsUrl: 'https://investors.example.com/',
    });

    expect(item).toMatchObject({
      source: 'INVESTOR_RELATIONS',
      externalId: 'release-1',
      primarySource: true,
      category: 'COMPANY_ANNOUNCEMENT',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
