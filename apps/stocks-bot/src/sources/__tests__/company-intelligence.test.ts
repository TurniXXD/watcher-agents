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
  it('ignores Micron product links on the newsroom page', async () => {
    const source = new CompanyIntelligenceSource(
      async (input) => {
        const url = requestUrl(input);
        if (url === 'https://www.micron.com/about/press/news') {
          return new Response(`<html><body>
            <a href="/products/storage/ssd/automotive-industrial-ssd-storage">Micron automotive and industrial SSD storage products</a>
            <div class="cmp-teaser"><h2 class="cmp-teaser__title">Micron announces a new memory module for next-generation servers</h2>
              <div class="cmp-teaser__description">September 15, 2026</div>
              <a href="https://investors.micron.com/news/press-release/2026/new-memory-module/default.aspx">Read article</a>
            </div>
          </body></html>`);
        }
        if (url.endsWith('/2026/new-memory-module/default.aspx')) {
          return new Response(
            '<article><p>Micron announced a new memory module for next-generation servers. The announcement identifies the product, availability expectations, and the applications it is designed to support.</p></article>',
          );
        }
        return new Response('<html><body>No articles</body></html>');
      },
      async (url) => new URL(url),
    );

    const items = await source.fetch({ symbol: 'MU' });

    expect(items).toHaveLength(1);
    expect(items[0]?.url).toBe(
      'https://investors.micron.com/news/press-release/2026/new-memory-module/default.aspx',
    );
    expect(items[0]?.content).toContain('The announcement identifies');
  });

  it('keeps a verified Micron release headline if the linked investor page blocks fetching', async () => {
    const issues: string[] = [];
    const source = new CompanyIntelligenceSource(
      async (input) => {
        const url = requestUrl(input);
        if (url === 'https://www.micron.com/about/press/news') {
          return new Response(
            '<h2 class="cmp-teaser__title">Micron appoints a new leader for its research labs</h2><a href="https://investors.micron.com/news/press-release/2026/new-leader/default.aspx">Read article</a>',
          );
        }
        if (url.includes('investors.micron.com')) {
          return new Response('blocked', { status: 403 });
        }
        return new Response('<html><body>No articles</body></html>');
      },
      async (url) => new URL(url),
      (issue) => issues.push(`${issue.stage}:${issue.errorKind}`),
    );

    const items = await source.fetch({ symbol: 'MU' });

    expect(items).toHaveLength(1);
    expect(items[0]?.content).toBe(
      'Headline only; article text unavailable: Micron appoints a new leader for its research labs',
    );
    expect(issues).toContain('ARTICLE:HTTP_403');
  });

  it('maps first-party and peer announcements back to the watched ticker', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes('/news-release-details/')) {
        return new Response(
          `<html><body><article><h1>Company announcement</h1><p>The company reported new product and customer information in its own release. The release identifies the product, the announcement date, and the expected commercial availability.</p></article></body></html>`,
        );
      }
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
        articleTextAvailable: true,
      },
    });
    expect(items[0]?.content).toContain('The company reported new product');
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

    expect(fetcher).toHaveBeenCalledTimes(6);
    await expect(source.fetch({ symbol: 'NVDA' })).resolves.toEqual([]);
  });

  it('keeps a clearly labeled headline when article text is unavailable', async () => {
    const source = new CompanyIntelligenceSource(
      async () =>
        new Response(
          listing(
            'Credo announces new AI infrastructure connectivity platform',
            '/news-events/news-release-details/credo-ai-platform',
          ),
        ),
      async (url) => new URL(url),
    );

    const items = await source.fetch({ symbol: 'CRDO' });

    expect(items[0]?.content).toBe(
      'Headline only; article text unavailable: Credo announces new AI infrastructure connectivity platform',
    );
    expect(items[0]?.metadata.articleTextAvailable).toBe(false);
    expect(items[0]?.content).not.toContain('Monitoring focus');
  });

  it('uses a matching article description when the page has no article body', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes('/news-release-details/')) {
        return new Response(
          '<html><head><meta property="og:description" content="Credo announces an AI infrastructure connectivity platform with new product capabilities and a planned commercial release for data center customers."></head><body></body></html>',
        );
      }
      return new Response(
        listing(
          'Credo announces new AI infrastructure connectivity platform',
          '/news-events/news-release-details/credo-ai-platform',
        ),
      );
    });
    const source = new CompanyIntelligenceSource(
      fetcher,
      async (url) => new URL(url),
    );

    const items = await source.fetch({ symbol: 'CRDO' });

    expect(items[0]?.content).toContain(
      'Credo announces an AI infrastructure connectivity platform',
    );
    expect(items[0]?.metadata.articleTextAvailable).toBe(true);
  });

  it('reports one broken endpoint while keeping other first-party headlines', async () => {
    const issues: Array<{
      endpoint: string;
      stage: string;
      errorKind: string;
    }> = [];
    const source = new CompanyIntelligenceSource(
      async (input) => {
        const url = requestUrl(input);
        if (url.includes('credosemi.com')) {
          return new Response('not found', { status: 404 });
        }
        return new Response(
          listing(
            'Marvell reports quarterly results for data infrastructure business',
            '/news-events/news-release-details/marvell-results',
          ),
        );
      },
      async (url) => new URL(url),
      (issue) => issues.push(issue),
    );

    const items = await source.fetch({ symbol: 'CRDO' });

    expect(items).toHaveLength(2);
    expect(issues).toContainEqual(
      expect.objectContaining({ stage: 'LISTING', errorKind: 'HTTP_404' }),
    );
  });

  it('fails explicitly when every configured listing is unavailable', async () => {
    const source = new CompanyIntelligenceSource(
      async () => new Response('not found', { status: 404 }),
      async (url) => new URL(url),
    );

    await expect(source.fetch({ symbol: 'CRDO' })).rejects.toThrow(
      'All company intelligence listings failed for CRDO',
    );
  });
});
