import { createHash } from 'node:crypto';
import type { Source, WatchItem } from '@watcher/core';
import { z } from 'zod';

export type EarningsWhispersConfig = { symbol: string };

const upcomingSchema = z.object({
  ticker: z.string().min(1),
  company: z.string().min(1),
  nextEPSDate: z.string().nullable(),
  confirmDate: z.string().nullable(),
  quarterDate: z.string().nullable(),
  quarter: z.number().int().nullable(),
  consensusEst: z.number().nullable(),
  revenueEst: z.number().nullable(),
  whisper: z.number().nullable(),
  sectName: z.string().nullable(),
});

const latestSchema = z.object({
  epsDate: z.string().nullable(),
  ticker: z.string().min(1),
  name: z.string().min(1),
  subject: z.string().nullable(),
  quarter: z.string().nullable(),
  eps: z.number().nullable(),
  estimate: z.number().nullable(),
  whisper: z.number().nullable(),
  highEstimate: z.number().nullable(),
  lowEstimate: z.number().nullable(),
  revenue: z.number().nullable(),
  revenueEstimate: z.number().nullable(),
  earningsSurprise: z.number().nullable(),
  revenueSurprise: z.number().nullable(),
});

type Upcoming = z.infer<typeof upcomingSchema>;
type Latest = z.infer<typeof latestSchema>;

const requestSignal = (signal?: AbortSignal): AbortSignal =>
  signal
    ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
    : AbortSignal.timeout(30_000);

const cookieHeader = (headers: Headers): string => {
  const cookieHeaders =
    (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ??
    [headers.get('set-cookie')].filter(Boolean);

  return cookieHeaders
    .map((cookie) => cookie?.split(';', 1)[0]?.trim())
    .filter((cookie): cookie is string => Boolean(cookie?.includes('=')))
    .join('; ');
};

const fetchJson = async <T>(
  fetcher: typeof fetch,
  url: string,
  pageUrl: string,
  cookie: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T | undefined> => {
  const response = await fetcher(url, {
    headers: {
      accept: 'application/json',
      cookie,
      referer: pageUrl,
      'user-agent': 'Watcher/1.0 (+self-hosted stock watcher)',
    },
    signal: requestSignal(signal),
  });
  if (response.status === 204) return undefined;
  if (!response.ok)
    throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
  return schema.parse(await response.json());
};

const available = (value: number | string | null | undefined): string =>
  value === null || value === undefined || value === ''
    ? 'not available'
    : String(value);

const percentage = (value: number | null): string =>
  value === null ? 'not available' : `${(value * 100).toFixed(2)}%`;

const upcomingLines = (data: Upcoming): string[] => [
  'Upcoming earnings:',
  `Date: ${available(data.nextEPSDate)}`,
  `Confirmed at: ${available(data.confirmDate)}`,
  `Fiscal quarter: ${available(data.quarter)}`,
  `Quarter end: ${available(data.quarterDate)}`,
  `Consensus EPS: ${available(data.consensusEst)}`,
  `Earnings Whisper: ${available(data.whisper)}`,
  `Revenue estimate (USD): ${available(data.revenueEst)}`,
];

const latestLines = (data: Latest): string[] => [
  'Latest earnings:',
  `Headline: ${available(data.subject)}`,
  `Date: ${available(data.epsDate)}`,
  `Fiscal period: ${available(data.quarter)}`,
  `Actual EPS: ${available(data.eps)}`,
  `Consensus EPS: ${available(data.estimate)}`,
  `Earnings Whisper: ${available(data.whisper)}`,
  `Estimate range: ${available(data.lowEstimate)} to ${available(data.highEstimate)}`,
  `EPS surprise: ${percentage(data.earningsSurprise)}`,
  `Revenue actual (USD millions): ${available(data.revenue)}`,
  `Revenue estimate (USD millions): ${available(data.revenueEstimate)}`,
  `Revenue surprise: ${percentage(data.revenueSurprise)}`,
];

export class EarningsWhispersSource implements Source<EarningsWhispersConfig> {
  public readonly id = 'EARNINGS_WHISPERS';
  public readonly capabilities = {
    sourceName: 'Earnings Whispers',
    sourceType: 'ANALYST' as const,
    minimumIntervalMs: 15 * 60_000,
    preferredIntervalMs: 60 * 60_000,
    maximumIntervalMs: 24 * 60 * 60_000,
    supportsStreaming: false,
    costPerRequestUsd: 0,
    rateLimitPerMinute: null,
    priority: 60,
  };

  public constructor(private readonly fetcher: typeof fetch = fetch) {}

  public async fetch(
    config: EarningsWhispersConfig,
    signal?: AbortSignal,
  ): Promise<WatchItem[]> {
    const symbol = config.symbol.trim().toUpperCase();
    const encodedSymbol = encodeURIComponent(symbol);
    const pageUrl = `https://www.earningswhispers.com/stocks/${encodedSymbol}`;
    const page = await this.fetcher(pageUrl, {
      headers: {
        accept: 'text/html',
        'user-agent': 'Watcher/1.0 (+self-hosted stock watcher)',
      },
      signal: requestSignal(signal),
    });
    if (!page.ok)
      throw new Error(`HTTP ${page.status} from ${new URL(pageUrl).hostname}`);
    const cookie = cookieHeader(page.headers);
    await page.text();
    if (!cookie)
      throw new Error('Earnings Whispers did not establish a public session');

    const [upcoming, latest] = await Promise.all([
      fetchJson(
        this.fetcher,
        `https://www.earningswhispers.com/api/getstocksdata/${encodedSymbol}`,
        pageUrl,
        cookie,
        upcomingSchema,
        signal,
      ),
      fetchJson(
        this.fetcher,
        `https://www.earningswhispers.com/api/epsdetails/${encodedSymbol}`,
        pageUrl,
        cookie,
        latestSchema,
        signal,
      ),
    ]);
    if (!upcoming && !latest) return [];

    const companyName = upcoming?.company ?? latest?.name;
    const content = [
      `Ticker: ${symbol}`,
      `Company: ${companyName ?? 'not available'}`,
      ...(upcoming?.sectName ? [`Sector: ${upcoming.sectName}`] : []),
      ...(upcoming ? ['', ...upcomingLines(upcoming)] : []),
      ...(latest ? ['', ...latestLines(latest)] : []),
    ].join('\n');
    const externalId = createHash('sha256').update(content).digest('hex');

    return [
      {
        id: `${this.id}:${externalId}`,
        source: this.id,
        externalId,
        title: `${symbol} Earnings Whispers snapshot`,
        url: pageUrl,
        content,
        sourceType: 'ANALYST',
        primarySource: false,
        category: 'EARNINGS',
        normalizedFacts: {
          nextEarningsDate: upcoming?.nextEPSDate,
          consensusEstimate: upcoming?.consensusEst,
          earningsWhisper: upcoming?.whisper,
          latestEarningsDate: latest?.epsDate,
          latestEps: latest?.eps,
          latestEstimate: latest?.estimate,
        },
        entities: [symbol, ...(companyName ? [companyName] : [])],
        reliability: 0.65,
        metadata: {
          symbol,
          companyName,
          sector: upcoming?.sectName,
          nextEarningsDate: upcoming?.nextEPSDate,
          consensusEstimate: upcoming?.consensusEst,
          earningsWhisper: upcoming?.whisper,
          latestEarningsDate: latest?.epsDate,
          latestEps: latest?.eps,
          latestEstimate: latest?.estimate,
        },
      },
    ];
  }
}
