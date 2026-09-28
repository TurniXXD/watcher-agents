import { afterEach, describe, expect, it, vi } from 'vitest';
import { FederalRegisterSource } from '../federal-register.js';
import { OfficialAgencyNewsSource } from '../official-agency-news.js';

afterEach(() => vi.useRealTimers());

const requestUrl = (input: RequestInfo | URL): string =>
  typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

describe('FederalRegisterSource', () => {
  it('keeps only recent official notices that actually name the company in full text', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T12:00:00Z'));
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes('/api/v1/documents.json')) {
        const query = new URL(url);
        expect(query.searchParams.get('conditions[term]')).toBe(
          'Micron Technology, Inc.',
        );
        expect(
          query.searchParams.get('conditions[publication_date][gte]'),
        ).toBe('2026-06-26');
        return Response.json({
          results: [
            {
              document_number: '2026-10001',
              title: 'Notice of Section 337 complaint',
              abstract: 'A complaint concerning memory devices.',
              html_url:
                'https://www.federalregister.gov/documents/2026/09/20/2026-10001/test',
              publication_date: '2026-09-20',
              type: 'Notice',
              agencies: [
                {
                  name: 'International Trade Commission',
                  slug: 'international-trade-commission',
                },
              ],
            },
            {
              document_number: '2026-10002',
              title: 'Industry rule with a search-term false positive',
              abstract: 'No company-specific action.',
              html_url:
                'https://www.federalregister.gov/documents/2026/09/19/2026-10002/test',
              publication_date: '2026-09-19',
              agencies: [
                { name: 'Commerce Department', slug: 'commerce-department' },
              ],
            },
          ],
        });
      }
      return new Response(
        url.includes('2026-10001')
          ? 'Under Section 337, the complaint names Micron Technology, Inc. as respondent.'
          : 'This notice concerns Microsoft and unrelated memory technologies.',
      );
    });
    const source = new FederalRegisterSource(fetcher);

    const items = await source.fetch({
      symbol: 'MU',
      companyName: 'Micron Technology, Inc.',
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      source: 'FEDERAL_REGISTER',
      externalId: '2026-10001',
      category: 'PATENT',
      primarySource: true,
      normalizedFacts: { agencies: ['International Trade Commission'] },
    });
    await source.fetch({
      symbol: 'MU',
      companyName: 'Micron Technology, Inc.',
    });
    expect(
      fetcher.mock.calls.filter(([url]) =>
        requestUrl(url).includes('2026-10001'),
      ),
    ).toHaveLength(1);
  });

  it('reports a failed document but retains other successful notices', async () => {
    const onError = vi.fn();
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes('/api/v1/documents.json')) {
        return Response.json({
          results: ['2026-10001', '2026-10002'].map((number) => ({
            document_number: number,
            title: 'Agency action',
            html_url: `https://www.federalregister.gov/documents/2026/09/20/${number}/test`,
            publication_date: '2026-09-20',
            agencies: [
              {
                name: 'Federal Trade Commission',
                slug: 'federal-trade-commission',
              },
            ],
          })),
        });
      }
      if (url.includes('2026-10001'))
        return new Response('Unavailable', { status: 404 });
      return new Response('Agency action involving Micron Technology, Inc.');
    });
    const source = new FederalRegisterSource(fetcher, onError);

    const items = await source.fetch({
      symbol: 'MU',
      companyName: 'Micron Technology, Inc.',
    });

    expect(items).toHaveLength(1);
    expect(onError).toHaveBeenCalledWith('2026-10001', expect.anything());
  });
});

describe('OfficialAgencyNewsSource', () => {
  it('accepts relevant FTC press releases and rejects unrelated or off-domain links', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T12:00:00Z'));
    const fetcher = vi.fn(
      async () =>
        new Response(`<?xml version="1.0"?><rss><channel>
      <item><title>FTC challenges Micron Technology merger</title><link>https://www.ftc.gov/news-events/news/press-releases/test</link><guid>ftc-1</guid><pubDate>Thu, 24 Sep 2026 10:00:00 GMT</pubDate><description>FTC action involving Micron Technology, Inc.</description></item>
      <item><title>FTC action involving another company</title><link>https://www.ftc.gov/other</link><description>Other company.</description></item>
      <item><title>Micron Technology phishing copy</title><link>https://evil.example/ftc</link><description>Micron Technology Inc.</description></item>
    </channel></rss>`),
    );
    const source = new OfficialAgencyNewsSource('FTC', fetcher);

    const items = await source.fetch({
      symbol: 'MU',
      companyName: 'Micron Technology, Inc.',
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      source: 'FTC',
      externalId: 'ftc-1',
      primarySource: true,
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://www.ftc.gov/feeds/press-release-competition.xml',
      expect.anything(),
    );
  });

  it('does not use a bare ticker or unverified company name as identity evidence', async () => {
    const fetcher = vi.fn();
    const source = new OfficialAgencyNewsSource('DOJ', fetcher);

    await expect(source.fetch({ symbol: 'MU' })).resolves.toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reads the DOJ antitrust feed once for multiple tracked companies', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T12:00:00Z'));
    const fetcher = vi.fn(
      async () =>
        new Response(`<?xml version="1.0"?><rss><channel>
      <item><title>Justice Department challenges Acme Bio transaction</title><link>https://www.justice.gov/opa/pr/acme-bio</link><pubDate>Thu, 24 Sep 2026 10:00:00 GMT</pubDate><description>Acme Bio merger action.</description></item>
    </channel></rss>`),
    );
    const source = new OfficialAgencyNewsSource('DOJ', fetcher);

    expect(
      await source.fetch({ symbol: 'ACME', companyName: 'Acme Bio' }),
    ).toHaveLength(1);
    expect(
      await source.fetch({
        symbol: 'MU',
        companyName: 'Micron Technology, Inc.',
      }),
    ).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
