import { describe, expect, it, vi } from 'vitest';
import {
  AlpacaPaperClient,
  renderAlpacaPaperPortfolio,
} from '../alpaca-paper.js';

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200 });

describe('Alpaca Paper read-only client', () => {
  it('loads account state without making a mutating request', async () => {
    const fetcher = vi.fn(
      async (input: URL | RequestInfo, options?: RequestInit) => {
        void options;
        const url =
          input instanceof URL
            ? input
            : typeof input === 'string'
              ? new URL(input)
              : new URL(input.url);
        const path = url.pathname;
        if (path === '/v2/account') {
          return jsonResponse({
            id: 'account-1',
            status: 'ACTIVE',
            currency: 'USD',
            cash: '1000',
            equity: '1250',
            last_equity: '1200',
            portfolio_value: '1250',
            buying_power: '2500',
          });
        }
        if (path === '/v2/positions') {
          return jsonResponse([
            {
              symbol: 'MU',
              qty: '2',
              side: 'long',
              avg_entry_price: '100',
              current_price: '125',
              market_value: '250',
              unrealized_pl: '50',
              unrealized_plpc: '0.25',
            },
          ]);
        }
        return jsonResponse([
          {
            id: 'order-1',
            symbol: 'MU',
            side: 'buy',
            type: 'market',
            status: 'filled',
            qty: '2',
            filled_qty: '2',
            filled_avg_price: '100',
            submitted_at: '2026-09-22T10:00:00.000Z',
            filled_at: '2026-09-22T10:00:01.000Z',
            canceled_at: null,
          },
        ]);
      },
    );
    const client = new AlpacaPaperClient({
      apiKey: 'paper-key',
      apiSecret: 'paper-secret',
      fetcher,
    });

    const portfolio = await client.getPortfolio();

    expect(portfolio.account.equity).toBe(1250);
    expect(portfolio.positions).toHaveLength(1);
    expect(portfolio.recentOrders).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [, options] of fetcher.mock.calls) {
      expect(options).toMatchObject({ method: 'GET' });
      expect(options?.headers).toMatchObject({
        'APCA-API-KEY-ID': 'paper-key',
        'APCA-API-SECRET-KEY': 'paper-secret',
      });
    }
  });

  it('renders paper status without presenting it as a trading command', () => {
    expect(
      renderAlpacaPaperPortfolio({
        account: {
          id: 'account-1',
          status: 'ACTIVE',
          currency: 'USD',
          cash: 1000,
          equity: 1250,
          last_equity: 1200,
          portfolio_value: 1250,
          buying_power: 2500,
        },
        positions: [],
        recentOrders: [],
      }),
    ).toContain(
      'This command never creates, changes, cancels, or sends an order.',
    );
  });
});
