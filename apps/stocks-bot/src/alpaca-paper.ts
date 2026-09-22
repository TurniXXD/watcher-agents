import { z } from 'zod';

const decimalSchema = z.coerce.number().finite();
const timestampSchema = z.coerce.date().nullable().optional();

const accountSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  currency: z.string().min(1),
  cash: decimalSchema,
  equity: decimalSchema,
  last_equity: decimalSchema,
  portfolio_value: decimalSchema,
  buying_power: decimalSchema,
});

const positionSchema = z.object({
  symbol: z.string().min(1),
  qty: decimalSchema,
  side: z.string().min(1),
  avg_entry_price: decimalSchema,
  current_price: decimalSchema,
  market_value: decimalSchema,
  unrealized_pl: decimalSchema,
  unrealized_plpc: decimalSchema,
});

const orderSchema = z.object({
  id: z.string().min(1),
  symbol: z.string().min(1),
  side: z.string().min(1),
  type: z.string().min(1),
  status: z.string().min(1),
  qty: decimalSchema,
  filled_qty: decimalSchema,
  filled_avg_price: decimalSchema.nullable().optional(),
  submitted_at: timestampSchema,
  filled_at: timestampSchema,
  canceled_at: timestampSchema,
});

export type AlpacaPaperPortfolio = {
  account: z.infer<typeof accountSchema>;
  positions: Array<z.infer<typeof positionSchema>>;
  recentOrders: Array<z.infer<typeof orderSchema>>;
};

type AlpacaPaperClientOptions = {
  apiKey: string;
  apiSecret: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
};

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

const compactNumber = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 4,
});

const percentage = (value: number): string =>
  `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;

const orderTime = (order: z.infer<typeof orderSchema>): Date | null =>
  order.filled_at ?? order.submitted_at ?? order.canceled_at ?? null;

/**
 * Read-only client for Alpaca's paper endpoint. It deliberately exposes no
 * method that could create, replace, cancel, or otherwise alter an order.
 */
export class AlpacaPaperClient {
  readonly #apiKey: string;
  readonly #apiSecret: string;
  readonly #baseUrl: URL;
  readonly #fetcher: typeof fetch;

  public constructor({
    apiKey,
    apiSecret,
    baseUrl = 'https://paper-api.alpaca.markets',
    fetcher = fetch,
  }: AlpacaPaperClientOptions) {
    this.#apiKey = apiKey;
    this.#apiSecret = apiSecret;
    this.#baseUrl = new URL(baseUrl);
    this.#fetcher = fetcher;
  }

  public async getPortfolio(
    signal?: AbortSignal,
  ): Promise<AlpacaPaperPortfolio> {
    const [account, positions, recentOrders] = await Promise.all([
      this.get('/v2/account', accountSchema, signal),
      this.get('/v2/positions', z.array(positionSchema), signal),
      this.get(
        '/v2/orders?status=all&limit=5&direction=desc',
        z.array(orderSchema),
        signal,
      ),
    ]);
    return { account, positions, recentOrders };
  }

  private async get<T>(
    path: string,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await this.#fetcher(new URL(path, this.#baseUrl), {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'APCA-API-KEY-ID': this.#apiKey,
        'APCA-API-SECRET-KEY': this.#apiSecret,
      },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
        : AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`Alpaca Paper API request failed (${response.status}).`);
    }
    return schema.parse(await response.json());
  }
}

export const renderAlpacaPaperPortfolio = ({
  account,
  positions,
  recentOrders,
}: AlpacaPaperPortfolio): string => {
  const accountChange = account.equity - account.last_equity;
  const positionLines = positions.length
    ? positions.map((position) => {
        const gain = `${usd.format(position.unrealized_pl)} · ${percentage(position.unrealized_plpc)}`;
        return `• ${position.symbol} · ${position.side.toUpperCase()} ${compactNumber.format(position.qty)}\n  value ${usd.format(position.market_value)} · avg ${usd.format(position.avg_entry_price)} → now ${usd.format(position.current_price)}\n  unrealized ${gain}`;
      })
    : ['No open paper positions.'];
  const orderLines = recentOrders.length
    ? recentOrders.map((order) => {
        const when = orderTime(order)?.toISOString() ?? 'time unavailable';
        const fill = order.filled_avg_price
          ? ` · fill ${usd.format(order.filled_avg_price)}`
          : '';
        return `• ${order.symbol} · ${order.side.toUpperCase()} ${compactNumber.format(order.qty)} · ${order.type} · ${order.status}${fill}\n  ${when}`;
      })
    : ['No recent paper orders.'];
  return [
    '🦙 ALPACA PAPER ACCOUNT',
    '',
    `Status: ${account.status} · ${account.currency}`,
    `Equity: ${usd.format(account.equity)} (${accountChange >= 0 ? '+' : ''}${usd.format(accountChange)})`,
    `Cash: ${usd.format(account.cash)} · Buying power: ${usd.format(account.buying_power)}`,
    `Portfolio value: ${usd.format(account.portfolio_value)}`,
    '',
    `Open positions (${positions.length})`,
    ...positionLines,
    '',
    'Latest five orders',
    ...orderLines,
    '',
    'Paper environment only. This command never creates, changes, cancels, or sends an order.',
  ].join('\n');
};
