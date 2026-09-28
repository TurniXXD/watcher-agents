import { z } from 'zod';

const amountSchema = z.number().finite();
const currencySchema = z.string().regex(/^[A-Z]{3}$/u);

const accountSchema = z.object({
  currency: currencySchema,
  totalValue: amountSchema,
  cash: z.object({
    availableToTrade: amountSchema,
    inPies: amountSchema,
    reservedForOrders: amountSchema,
  }),
  investments: z.object({
    currentValue: amountSchema,
    totalCost: amountSchema,
    unrealizedProfitLoss: amountSchema,
    realizedProfitLoss: amountSchema,
  }),
});

const positionSchema = z.object({
  instrument: z.object({
    ticker: z.string().min(1).max(80),
    name: z.string().min(1).max(250),
    currency: currencySchema,
  }),
  quantity: amountSchema,
  quantityAvailableForTrading: amountSchema,
  quantityInPies: amountSchema,
  averagePricePaid: amountSchema,
  currentPrice: amountSchema,
  walletImpact: z.object({
    currency: currencySchema,
    totalCost: amountSchema,
    currentValue: amountSchema,
    unrealizedProfitLoss: amountSchema,
    fxImpact: amountSchema.nullable().optional(),
  }),
});

export type Trading212Portfolio = {
  account: z.infer<typeof accountSchema>;
  positions: z.infer<typeof positionSchema>[];
  asOf: Date;
  environment: 'LIVE' | 'DEMO';
};

type Trading212ClientOptions = {
  apiKey: string;
  apiSecret: string;
  environment: 'LIVE' | 'DEMO';
  fetcher?: typeof fetch;
  now?: () => Date;
};

const hosts = {
  LIVE: 'https://live.trading212.com',
  DEMO: 'https://demo.trading212.com',
} as const;

export const canViewTrading212 = (
  telegramUserId: number | undefined,
  telegramChatId: number,
  chatType: string,
  ownerTelegramUserId: number,
): boolean =>
  chatType === 'private' &&
  telegramUserId === ownerTelegramUserId &&
  telegramChatId === ownerTelegramUserId;

/** Read-only: this client exposes only two fixed GET requests. */
export class Trading212Client {
  readonly #authorization: string;
  readonly #host: string;
  readonly #fetcher: typeof fetch;
  readonly #now: () => Date;
  readonly #environment: 'LIVE' | 'DEMO';
  #cache: { until: number; value: Trading212Portfolio } | undefined;
  #inFlight: Promise<Trading212Portfolio> | undefined;

  public constructor({
    apiKey,
    apiSecret,
    environment,
    fetcher = fetch,
    now = () => new Date(),
  }: Trading212ClientOptions) {
    this.#authorization = `Basic ${Buffer.from(`${apiKey}:${apiSecret}`, 'utf8').toString('base64')}`;
    this.#host = hosts[environment];
    this.#environment = environment;
    this.#fetcher = fetcher;
    this.#now = now;
  }

  public async getPortfolio(
    signal?: AbortSignal,
  ): Promise<Trading212Portfolio> {
    if (this.#cache && this.#cache.until > this.#now().getTime()) {
      return this.#cache.value;
    }
    if (this.#inFlight) return this.#inFlight;
    this.#inFlight = this.load(signal).finally(() => {
      this.#inFlight = undefined;
    });
    return this.#inFlight;
  }

  private async load(signal?: AbortSignal): Promise<Trading212Portfolio> {
    const account = await this.get(
      '/api/v0/equity/account/summary',
      accountSchema,
      signal,
    );
    const positions = await this.get(
      '/api/v0/equity/positions',
      z.array(positionSchema),
      signal,
    );
    const value: Trading212Portfolio = {
      account,
      positions,
      asOf: this.#now(),
      environment: this.#environment,
    };
    this.#cache = { until: value.asOf.getTime() + 5_000, value };
    return value;
  }

  private async get<T>(
    path: '/api/v0/equity/account/summary' | '/api/v0/equity/positions',
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.#fetcher(`${this.#host}${path}`, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: this.#authorization,
        },
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
          : AbortSignal.timeout(15_000),
      });
    } catch {
      throw new Error('Trading 212 is unreachable or timed out.');
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        'Trading 212 rejected the API credentials, read permissions, or IP restriction.',
      );
    }
    if (response.status === 429) {
      throw new Error('Trading 212 rate limit reached. Try again shortly.');
    }
    if (!response.ok) {
      throw new Error(`Trading 212 request failed (HTTP ${response.status}).`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error('Trading 212 returned unreadable JSON.');
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new Error('Trading 212 returned an unexpected response shape.');
    }
    return parsed.data;
  }
}

const money = (value: number, currency: string): string =>
  new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value);

const number = (value: number): string =>
  new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 6 }).format(value);

const signedMoney = (value: number, currency: string): string =>
  `${value > 0 ? '+' : ''}${money(value, currency)}`;

const percent = (numerator: number, denominator: number): string =>
  denominator > 0
    ? `${numerator >= 0 ? '+' : ''}${((numerator / denominator) * 100).toFixed(2)} %`
    : 'n/a';

const positionValue = (
  position: Trading212Portfolio['positions'][number],
  accountCurrency: string,
): number =>
  position.walletImpact.currency === accountCurrency
    ? position.walletImpact.currentValue
    : 0;

const byValue = (portfolio: Trading212Portfolio) =>
  [...portfolio.positions].sort(
    (left, right) =>
      positionValue(right, portfolio.account.currency) -
      positionValue(left, portfolio.account.currency),
  );

const header = (portfolio: Trading212Portfolio, title: string): string[] => [
  title,
  `Účet: ${portfolio.environment === 'LIVE' ? 'živý' : 'demo'} · měna ${portfolio.account.currency}`,
  `Stav: ${portfolio.asOf.toISOString()} · údaje Trading 212`,
];

export const renderTrading212Positions = (
  portfolio: Trading212Portfolio,
): string => {
  const { account } = portfolio;
  const lines = [
    ...header(portfolio, '📊 TRADING 212 · POZICE'),
    '',
    `Celková hodnota účtu: ${money(account.totalValue, account.currency)}`,
    `Investice: ${money(account.investments.currentValue, account.currency)} · hotovost k obchodování: ${money(account.cash.availableToTrade, account.currency)}`,
    `Nerealizovaný výsledek: ${signedMoney(account.investments.unrealizedProfitLoss, account.currency)}`,
    '',
    `Otevřené pozice (${portfolio.positions.length})`,
  ];
  if (portfolio.positions.length === 0) lines.push('Žádné otevřené pozice.');
  for (const position of byValue(portfolio)) {
    const { instrument, walletImpact } = position;
    lines.push(
      `• ${instrument.ticker} — ${instrument.name}`,
      `  ${number(position.quantity)} ks · průměr ${money(position.averagePricePaid, instrument.currency)} → cena ${money(position.currentPrice, instrument.currency)} (${instrument.currency})`,
      `  hodnota ${money(walletImpact.currentValue, walletImpact.currency)} · P/L ${signedMoney(walletImpact.unrealizedProfitLoss, walletImpact.currency)} (${percent(walletImpact.unrealizedProfitLoss, walletImpact.totalCost)}) · ${walletImpact.currency}`,
    );
    if (position.quantityInPies > 0) {
      lines.push(`  v Pies: ${number(position.quantityInPies)} ks`);
    }
  }
  lines.push('', 'Pouze čtení; bot nikdy neposílá obchodní pokyny.');
  return lines.join('\n');
};

export const renderTrading212Report = (
  portfolio: Trading212Portfolio,
): string => {
  const { account } = portfolio;
  const positions = byValue(portfolio);
  const comparable = positions.filter(
    ({ walletImpact }) => walletImpact.currency === account.currency,
  );
  const lines = [
    ...header(portfolio, '📈 TRADING 212 · REPORT'),
    '',
    `Celkem: ${money(account.totalValue, account.currency)}`,
    `Investice: ${money(account.investments.currentValue, account.currency)} · pořizovací náklady ${money(account.investments.totalCost, account.currency)}`,
    `Nerealizovaný P/L: ${signedMoney(account.investments.unrealizedProfitLoss, account.currency)} (${percent(account.investments.unrealizedProfitLoss, account.investments.totalCost)})`,
    `Realizovaný P/L dle Trading 212: ${signedMoney(account.investments.realizedProfitLoss, account.currency)}`,
    `Hotovost k obchodování: ${money(account.cash.availableToTrade, account.currency)}`,
    '',
    `Počet otevřených pozic: ${positions.length}`,
  ];
  if (comparable.length > 0) {
    lines.push('Největší podíly na investicích:');
    for (const position of comparable.slice(0, 5)) {
      const share =
        account.investments.currentValue > 0
          ? `${((position.walletImpact.currentValue / account.investments.currentValue) * 100).toFixed(1)} %`
          : 'n/a';
      lines.push(
        `• ${position.instrument.ticker}: ${money(position.walletImpact.currentValue, account.currency)} (${share})`,
      );
    }
    const winners = [...comparable].sort(
      (left, right) =>
        right.walletImpact.unrealizedProfitLoss -
        left.walletImpact.unrealizedProfitLoss,
    );
    const best = winners[0];
    const worst = winners.at(-1);
    if (best && best.walletImpact.unrealizedProfitLoss > 0) {
      lines.push(
        `Největší nerealizovaný zisk: ${best.instrument.ticker} ${signedMoney(best.walletImpact.unrealizedProfitLoss, account.currency)}`,
      );
    }
    if (worst && worst.walletImpact.unrealizedProfitLoss < 0) {
      lines.push(
        `Největší nerealizovaná ztráta: ${worst.instrument.ticker} ${signedMoney(worst.walletImpact.unrealizedProfitLoss, account.currency)}`,
      );
    }
  }
  if (comparable.length < positions.length) {
    lines.push(
      'Pozice s jinou měnou walletImpact nejsou zahrnuty do žebříčku podílů.',
    );
  }
  lines.push(
    '',
    'Souhrn skutečného účtu, nikoli výzkumná teze ani investiční doporučení. Ceny a hodnoty se mohou mezi dvěma API odpověďmi změnit.',
  );
  return lines.join('\n');
};
