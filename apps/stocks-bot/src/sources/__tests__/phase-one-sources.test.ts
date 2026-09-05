import { describe, expect, it, vi } from 'vitest';
import { InvestorRelationsSource } from '../investor-relations.js';
import { GdeltNewsSource } from '../news.js';

const resolvePublicUrl = vi.fn(async (value: string) => new URL(value));
const requestUrl = (input: RequestInfo | URL): string =>
  typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

describe('GdeltNewsSource', () => {
  it('normalizes structured article-list results', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return Response.json({
        articles: [
          {
            url: 'https://example.com/micron-event',
            title: 'Micron announces a new product',
            seendate: '20260904T061500Z',
            domain: 'example.com',
            language: 'English',
            sourcecountry: 'United States',
          },
        ],
      });
    });
    const source = new GdeltNewsSource(fetcher);

    const [item] = await source.fetch({
      symbol: 'mu',
      companyName: 'Micron Technology, Inc.',
    });

    expect(item).toMatchObject({
      source: 'NEWS',
      title: 'Micron announces a new product',
      sourceType: 'NEWS',
      category: 'NEWS',
      metadata: { symbol: 'MU', publisherDomain: 'example.com' },
    });
    expect(item?.publishedAt?.toISOString()).toBe('2026-09-04T06:15:00.000Z');
    expect(requestUrl(fetcher.mock.calls[0]![0])).toContain(
      'api.gdeltproject.org/api/v2/doc/doc',
    );
  });
});

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
