import { describe, expect, it, vi } from 'vitest';
import { CompanyIntelligenceSource } from '../company-intelligence/source.js';

const requestUrl = (input: RequestInfo | URL): string =>
  typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

const listing = (headline: string, href: string): string => `
  <html><body>
    <nav><a href="/news">News</a><a href="/contact">Contact</a></nav>
    <article><a href="${href}">${headline}</a></article>
  </body></html>`;

describe('CompanyIntelligenceSource', () => {
  it('maps first-party and peer announcements back to the watched ticker', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes('credosemi.com')) {
        return new Response(
          listing(
            'Credo announces new AI infrastructure connectivity platform',
            '/news-events/news-release-details/credo-ai-platform',
          ),
        );
      }
      if (url.includes('marvell.com')) {
        return new Response(
          listing(
            'Marvell reports quarterly results for data infrastructure business',
            '/news-events/news-release-details/marvell-results',
          ),
        );
      }
      return new Response(
        listing(
          'Astera Labs launches new connectivity products for AI systems',
          '/news-events/news-release-details/astera-launch',
        ),
      );
    });
    const source = new CompanyIntelligenceSource(
      fetcher,
      async (url) => new URL(url),
    );

    const items = await source.fetch({ symbol: 'crdo' });

    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      source: 'COMPANY_INTELLIGENCE',
      category: 'COMPANY_EVENT',
      primarySource: true,
      metadata: {
        symbol: 'CRDO',
        companyIntelligenceRelationship: 'SUBJECT',
        relatedTicker: 'CRDO',
      },
    });
    expect(items[1]).toMatchObject({
      category: 'COMPETITOR_EVENT',
      primarySource: false,
      metadata: {
        symbol: 'CRDO',
        companyIntelligenceRelationship: 'PEER',
        relatedTicker: 'MRVL',
      },
    });
    expect(items.map((item) => item.externalId)).toEqual(
      expect.arrayContaining([expect.stringContaining('CRDO:https://')]),
    );
  });

  it('uses the short per-page cache and ignores unprofiled symbols', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          listing(
            'Credo announces new AI infrastructure connectivity platform',
            '/news-events/news-release-details/credo-ai-platform',
          ),
        ),
    );
    const source = new CompanyIntelligenceSource(
      fetcher,
      async (url) => new URL(url),
    );

    await source.fetch({ symbol: 'CRDO' });
    await source.fetch({ symbol: 'CRDO' });

    expect(fetcher).toHaveBeenCalledTimes(3);
    await expect(source.fetch({ symbol: 'NVDA' })).resolves.toEqual([]);
  });
});
