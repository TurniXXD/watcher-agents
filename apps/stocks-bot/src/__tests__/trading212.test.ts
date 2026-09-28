import { describe, expect, it, vi } from 'vitest';
import {
  Trading212Client,
  canViewTrading212,
  renderTrading212Positions,
  renderTrading212Report,
} from '../trading212.js';

const account = {
  id: 123456,
  currency: 'CZK',
  totalValue: 30_000,
  cash: {
    availableToTrade: 5_000,
    inPies: 0,
    reservedForOrders: 0,
  },
  investments: {
    currentValue: 25_000,
    totalCost: 20_000,
    unrealizedProfitLoss: 5_000,
    realizedProfitLoss: 400,
  },
};

const positions = [
  {
    instrument: {
      ticker: 'MU_US_EQ',
      name: 'Micron Technology',
      currency: 'USD',
    },
    quantity: 2.5,
    quantityAvailableForTrading: 1.5,
    quantityInPies: 1,
    averagePricePaid: 100,
    currentPrice: 120,
    walletImpact: {
      currency: 'CZK',
      totalCost: 20_000,
      currentValue: 25_000,
      unrealizedProfitLoss: 5_000,
      fxImpact: 100,
    },
  },
];

const response = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

const requestUrl = (input: RequestInfo | URL): string =>
  typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

describe('Trading212Client', () => {
  it('allows only the configured owner in a private chat', () => {
    expect(canViewTrading212(123, 123, 'private', 123)).toBe(true);
    expect(canViewTrading212(456, 456, 'private', 123)).toBe(false);
    expect(canViewTrading212(123, -100, 'group', 123)).toBe(false);
    expect(canViewTrading212(undefined, 123, 'private', 123)).toBe(false);
  });

  it('uses only official read-only endpoints, Basic auth, and a short cache', async () => {
    const fetcher = vi.fn(
      async (url: RequestInfo | URL, options?: RequestInit) => {
        void options;
        return response(
          requestUrl(url).endsWith('/account/summary') ? account : positions,
        );
      },
    );
    let current = new Date('2026-09-28T10:00:00.000Z');
    const client = new Trading212Client({
      apiKey: 'key-test',
      apiSecret: 'secret-test',
      environment: 'LIVE',
      fetcher,
      now: () => current,
    });

    const portfolio = await client.getPortfolio();
    await client.getPortfolio();

    expect(portfolio.account.investments.currentValue).toBe(25_000);
    expect(portfolio.positions).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(([url]) => requestUrl(url))).toEqual([
      'https://live.trading212.com/api/v0/equity/account/summary',
      'https://live.trading212.com/api/v0/equity/positions',
    ]);
    for (const [, options] of fetcher.mock.calls) {
      expect(options).toMatchObject({
        method: 'GET',
        headers: {
          authorization: `Basic ${Buffer.from('key-test:secret-test').toString('base64')}`,
        },
      });
    }
    current = new Date('2026-09-28T10:00:06.000Z');
    await client.getPortfolio();
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('fails closed on malformed data and never exposes credentials in errors', async () => {
    const client = new Trading212Client({
      apiKey: 'private-key',
      apiSecret: 'private-secret',
      environment: 'DEMO',
      fetcher: vi.fn(async () => response({ unexpected: true })),
    });

    await expect(client.getPortfolio()).rejects.toThrow(
      'unexpected response shape',
    );
    await expect(client.getPortfolio()).rejects.not.toThrow(/private-secret/u);
  });

  it('surfaces permission and rate-limit failures without storing stale data', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({}, 403))
      .mockResolvedValueOnce(response(account))
      .mockResolvedValueOnce(response({}, 429));
    const client = new Trading212Client({
      apiKey: 'key',
      apiSecret: 'secret',
      environment: 'LIVE',
      fetcher,
    });

    await expect(client.getPortfolio()).rejects.toThrow(/permissions/u);
    await expect(client.getPortfolio()).rejects.toThrow(/rate limit/u);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('keeps account-currency P/L separate from instrument-currency prices', async () => {
    const portfolio = {
      account,
      positions,
      environment: 'LIVE' as const,
      asOf: new Date('2026-09-28T10:00:00.000Z'),
    };
    const detailed = renderTrading212Positions(portfolio);
    const report = renderTrading212Report(portfolio);

    expect(detailed).toContain('MU_US_EQ — Micron Technology');
    expect(detailed).toContain('Pies: 1');
    expect(detailed).toContain('USD');
    expect(detailed).toContain('CZK');
    expect(report).toContain('Největší podíly na investicích:');
    expect(report).toContain('100.0 %');
    expect(report).toContain('nikoli výzkumná teze ani investiční doporučení');
  });
});
