import { describe, expect, it, vi } from 'vitest';
import { QuiverSource } from '../quiver.js';

describe('QuiverSource', () => {
  it('authenticates and normalizes insider transactions for shared classification', async () => {
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return Response.json([
          {
            Ticker: 'MU',
            Date: '2026-09-01T00:00:00Z',
            Name: 'Jane Doe',
            AcquiredDisposedCode: 'D',
            TransactionCode: 'S',
            Shares: 1000,
            PricePerShare: 100,
            SharesOwnedFollowing: 9000,
            fileDate: '2026-09-03T12:00:00Z',
            officerTitle: 'Chief Executive Officer',
          },
        ]);
      },
    );
    const source = new QuiverSource('QUIVER_INSIDERS', 'secret', fetcher);

    const [item] = await source.fetch({ symbol: 'mu' });

    expect(item).toMatchObject({
      source: 'QUIVER_INSIDERS',
      category: 'INSIDER_TRANSACTION',
      primarySource: false,
      normalizedFacts: {
        owner: 'Jane Doe',
        transactionCode: 'S',
        shares: 1000,
        pricePerShare: 100,
        transactionValue: 100_000,
      },
    });
    const request = fetcher.mock.calls[0];
    expect(request?.[0]).toBeTypeOf('string');
    expect(request?.[0] as string).toContain('/beta/live/insiders?ticker=MU');
    expect(new Headers(request?.[1]?.headers).get('authorization')).toBe(
      'Bearer secret',
    );
    expect(JSON.stringify(item)).not.toContain('secret');
  });

  it('normalizes off-exchange data as a context snapshot', async () => {
    const source = new QuiverSource(
      'QUIVER_OFF_EXCHANGE',
      'secret',
      vi.fn(async () =>
        Response.json([
          {
            Ticker: 'MU',
            Date: '2026-09-04T00:00:00Z',
            OTC_Short: 1_500_000,
            OTC_Total: 2_000_000,
            DPI: 0.75,
          },
        ]),
      ),
    );

    await expect(source.fetch({ symbol: 'MU' })).resolves.toMatchObject([
      {
        category: 'OFF_EXCHANGE_SNAPSHOT',
        normalizedFacts: {
          shortVolume: 1_500_000,
          totalVolume: 2_000_000,
          dpi: 0.75,
        },
      },
    ]);
  });

  it('rejects malformed provider responses at the boundary', async () => {
    const source = new QuiverSource(
      'QUIVER_PATENTS',
      'secret',
      vi.fn(async () => Response.json([{ unexpected: true }])),
    );

    await expect(source.fetch({ symbol: 'MU' })).rejects.toThrow();
  });

  it('normalizes lobbying disclosures as secondary context', async () => {
    const source = new QuiverSource(
      'QUIVER_LOBBYING',
      'secret',
      vi.fn(async () =>
        Response.json([
          {
            Ticker: 'MU',
            Date: '2026-08-31',
            Client: 'Micron Technology',
            Registrant: 'Example Government Affairs',
            Amount: 250000,
            SpecificIssue: 'Semiconductor policy',
          },
        ]),
      ),
    );

    await expect(source.fetch({ symbol: 'MU' })).resolves.toMatchObject([
      {
        source: 'QUIVER_LOBBYING',
        category: 'LOBBYING_DISCLOSURE',
        primarySource: false,
        normalizedFacts: { amount: 250000, issue: 'Semiconductor policy' },
      },
    ]);
  });
});
