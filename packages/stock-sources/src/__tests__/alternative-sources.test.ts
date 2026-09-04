import { describe, expect, it, vi } from 'vitest';
import { EarningsWhispersSource } from '../earnings-whispers.js';
import { FinvizInsiderSource } from '../finviz.js';
import { ZacksSource } from '../zacks.js';

const requestUrl = (input: RequestInfo | URL): string =>
  typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

describe('FinvizInsiderSource', () => {
  it('normalizes recent ticker insider rows and preserves distinct transactions', async () => {
    const html = `
      <table>
        <tr class="fv-insider-row is-sale-2">
          <td><a href="insidertrading?oc=1">Jane Doe</a></td>
          <td>Chief Executive Officer</td>
          <td>Aug 21 '26</td>
          <td class="transaction"><span>Sale</span></td>
          <td>98.90</td><td>1,000</td><td>98,900</td><td>9,000</td>
          <td><a href="http://www.sec.gov/Archives/edgar/data/1/form.xml">Aug 25 07:08 PM</a></td>
        </tr>
        <tr class="fv-insider-row is-sale-2">
          <td>Jane Doe</td><td>Chief Executive Officer</td><td>Aug 21 '26</td>
          <td><span>Sale</span></td><td>99.10</td><td>500</td><td>49,550</td><td>8,500</td>
          <td><a href="http://www.sec.gov/Archives/edgar/data/1/form.xml">Aug 25 07:08 PM</a></td>
        </tr>
      </table>`;
    const mockFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return new Response(html, { status: 200 });
      },
    );
    const source = new FinvizInsiderSource(mockFetch);

    const items = await source.fetch({ symbol: 'mu' });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      source: 'FINVIZ',
      title: 'MU insider Sale: Jane Doe',
      url: 'https://www.sec.gov/Archives/edgar/data/1/form.xml',
      metadata: {
        symbol: 'MU',
        relationship: 'Chief Executive Officer',
        shares: '1,000',
      },
    });
    expect(items[0]?.publishedAt?.toISOString()).toBe(
      '2026-08-21T00:00:00.000Z',
    );
    expect(items[0]?.externalId).not.toBe(items[1]?.externalId);
    expect(mockFetch.mock.calls[0]?.[0]).toBe(
      'https://finviz.com/quote.ashx?t=MU&p=d',
    );
    const headers = new Headers(mockFetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get('accept')).toContain('text/html');
  });
});

describe('ZacksSource', () => {
  const response = JSON.stringify({
    MU: {
      ticker: 'MU',
      name: 'Micron Technology, Inc.',
      zacks_rank: '2',
      zacks_rank_text: 'Buy',
      last: '958.16',
      net_change: '2.08',
      percent_net_change: '.2175',
      updated: 'Sep 03, 2026 04:00 PM',
      market_status: 'Full Trading Day (Market Closed)',
      pe_f1: '6.06',
      confirmed_reporting_date: '09/30/2026',
    },
  });

  it('normalizes a public Zacks quote and rank snapshot', async () => {
    const source = new ZacksSource(
      vi.fn(async () => new Response(response, { status: 200 })),
    );

    const [item] = await source.fetch({ symbol: 'mu' });

    expect(item).toMatchObject({
      source: 'ZACKS',
      title: 'MU Zacks 2-Buy',
      metadata: {
        symbol: 'MU',
        companyName: 'Micron Technology, Inc.',
        rank: '2',
        rankText: 'Buy',
        price: '958.16',
        confirmedEarningsDate: '09/30/2026',
      },
    });
    expect(item?.content).toContain('Zacks Rank: 2-Buy');
  });

  it('fails explicitly when the requested ticker is absent', async () => {
    const source = new ZacksSource(
      vi.fn(async () => new Response(JSON.stringify({}))),
    );

    await expect(source.fetch({ symbol: 'MU' })).rejects.toThrow(
      'Zacks quote was not found for MU',
    );
  });
});

describe('EarningsWhispersSource', () => {
  const upcoming = {
    ticker: 'MU',
    company: 'Micron Technology, Inc.',
    nextEPSDate: '2026-09-30T00:00:00',
    confirmDate: '2026-08-26T16:20:09.007',
    quarterDate: '2026-08-31T00:00:00',
    quarter: 4,
    consensusEst: 31.17,
    revenueEst: 50_760_000_000,
    whisper: null,
    sectName: 'Technology',
  };
  const latest = {
    epsDate: '2026-06-24T16:01:00',
    ticker: 'MU',
    name: 'Micron Technology, Inc.',
    subject: 'Micron Technology Beat Expectations',
    quarter: 'fiscal third quarter ended May 2026',
    eps: 24.89,
    estimate: 20.98,
    whisper: 22.15,
    highEstimate: 26,
    lowEstimate: 19.1,
    revenue: 41_456,
    revenueEstimate: 34_980,
    earningsSurprise: 0.1237,
    revenueSurprise: 0.1851,
  };

  it('uses a public session and normalizes one combined earnings snapshot', async () => {
    const mockFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void init;
        const url = requestUrl(input);
        if (url.endsWith('/stocks/MU')) {
          return new Response('<html></html>', {
            headers: { 'set-cookie': 'anonymous=session-id; Path=/; HttpOnly' },
          });
        }
        if (url.includes('/api/getstocksdata/')) return Response.json(upcoming);
        if (url.includes('/api/epsdetails/')) return Response.json(latest);
        throw new Error(`Unexpected URL: ${url}`);
      },
    );
    const source = new EarningsWhispersSource(mockFetch);

    const [item] = await source.fetch({ symbol: 'mu' });

    expect(item).toMatchObject({
      source: 'EARNINGS_WHISPERS',
      title: 'MU Earnings Whispers snapshot',
      url: 'https://www.earningswhispers.com/stocks/MU',
      metadata: {
        symbol: 'MU',
        companyName: 'Micron Technology, Inc.',
        nextEarningsDate: '2026-09-30T00:00:00',
        consensusEstimate: 31.17,
        earningsWhisper: null,
        latestEps: 24.89,
      },
    });
    expect(item?.content).toContain('Upcoming earnings:');
    expect(item?.content).toContain('Earnings Whisper: not available');
    expect(item?.content).toContain('EPS surprise: 12.37%');
    expect(item?.content).toContain('Revenue actual (USD millions): 41456');
    expect(mockFetch).toHaveBeenCalledTimes(3);
    for (const call of mockFetch.mock.calls.slice(1)) {
      const headers = new Headers(call[1]?.headers);
      expect(headers.get('cookie')).toBe('anonymous=session-id');
      expect(headers.get('referer')).toBe(
        'https://www.earningswhispers.com/stocks/MU',
      );
    }
  });

  it('returns no items when neither public endpoint has ticker data', async () => {
    const mockFetch = vi.fn(async (input: RequestInfo | URL) =>
      requestUrl(input).includes('/stocks/')
        ? new Response('', { headers: { 'set-cookie': 'anon=1; Path=/' } })
        : new Response(null, { status: 204 }),
    );

    await expect(
      new EarningsWhispersSource(mockFetch).fetch({ symbol: 'NONE' }),
    ).resolves.toEqual([]);
  });

  it('fails explicitly if the public page does not establish a session', async () => {
    const source = new EarningsWhispersSource(
      vi.fn(async () => new Response('<html></html>')),
    );

    await expect(source.fetch({ symbol: 'MU' })).rejects.toThrow(
      'Earnings Whispers did not establish a public session',
    );
  });
});
