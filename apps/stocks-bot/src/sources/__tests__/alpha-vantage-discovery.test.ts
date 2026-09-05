import { describe, expect, it } from 'vitest';
import { AlphaVantageDiscoveryScanner } from '../alpha-vantage-discovery.js';

describe('AlphaVantageDiscoveryScanner', () => {
  it('normalizes market movers with the configured entitlement', async () => {
    const requestedUrls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      requestedUrls.push(
        input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.toString()
            : input,
      );
      return Response.json({
        last_updated: '2026-09-04 16:00:00 US/Eastern',
        top_gainers: [
          {
            ticker: 'xyz',
            price: '10.50',
            change_amount: '1.50',
            change_percentage: '16.6667%',
            volume: '1234567',
          },
        ],
        top_losers: [],
        most_actively_traded: [],
      });
    };
    const scanner = new AlphaVantageDiscoveryScanner(
      'secret-key',
      'DELAYED',
      fetcher,
      () => new Date('2026-09-04T20:00:00Z'),
    );

    await expect(scanner.scan('INTRADAY')).resolves.toEqual([
      {
        ticker: 'XYZ',
        price: 10.5,
        changePercent: 16.6667,
        volume: 1_234_567,
        observedAt: new Date('2026-09-04T20:00:00Z'),
        snapshotId: '2026-09-04 16:00:00 US/Eastern',
        source: 'ALPHA_VANTAGE_MARKET_MOVERS',
        trigger: 'PRICE_MOVE',
      },
    ]);
    const requested = requestedUrls[0] ?? '';
    expect(requested).toContain('entitlement=delayed');
    expect(requested).toContain('apikey=secret-key');
  });

  it('turns provider notes into bounded source errors', async () => {
    const fetcher: typeof fetch = async () =>
      Response.json({ Note: 'Rate limit reached.' });
    const scanner = new AlphaVantageDiscoveryScanner(
      'secret-key',
      'EOD',
      fetcher,
    );

    await expect(scanner.scan('DAILY')).rejects.toThrow(
      'Alpha Vantage unavailable: Rate limit reached.',
    );
  });
});
