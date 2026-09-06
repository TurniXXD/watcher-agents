import { createHash } from 'node:crypto';
import {
  finiteNumber,
  parseDate,
  sourceHttpError,
  type Source,
  type WatchItem,
} from '@watcher/core';
import { z } from 'zod';

export type AlphaVantageStockConfig = { symbol: string; maxItems?: number };

const recordSchema = z.record(z.string(), z.unknown());
const responseSchema = z
  .object({
    data: z.array(recordSchema).optional(),
    holdings: z.array(recordSchema).optional(),
    Information: z.string().optional(),
    Note: z.string().optional(),
    'Error Message': z.string().optional(),
  })
  .loose();

const stringValue = (
  row: Record<string, unknown>,
  ...keys: string[]
): string | null => {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
};

const numericValue = (
  row: Record<string, unknown>,
  ...keys: string[]
): number | null => {
  for (const key of keys) {
    const value = finiteNumber(row[key]);
    if (value !== null) return value;
  }
  return null;
};

const hash = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

const checkedRows = async (
  fetcher: typeof fetch,
  url: URL,
  signal?: AbortSignal,
): Promise<Record<string, unknown>[]> => {
  const response = await fetcher(url, {
    headers: { accept: 'application/json' },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw sourceHttpError(response, url);
  }
  const payload = responseSchema.parse(await response.json());
  const providerError =
    payload['Error Message'] ?? payload.Note ?? payload.Information;
  if (providerError) throw new Error(`Alpha Vantage: ${providerError}`);
  return payload.data ?? payload.holdings ?? [];
};

export class AlphaVantageOptionsSource implements Source<AlphaVantageStockConfig> {
  public readonly id = 'ALPHA_VANTAGE_OPTIONS';
  public readonly capabilities = {
    sourceName: 'Alpha Vantage realtime options',
    sourceType: 'MARKET_DATA' as const,
    minimumIntervalMs: 15 * 60_000,
    preferredIntervalMs: 60 * 60_000,
    maximumIntervalMs: 24 * 60 * 60_000,
    supportsStreaming: false,
    costPerRequestUsd: 0,
    rateLimitPerMinute: null,
    priority: 55,
    requestPolicy: {
      providerKey: 'ALPHA_VANTAGE',
      maxConcurrency: 1,
      minimumSpacingMs: 1_100,
      sharedRateLimitBackoff: true,
    },
  };

  public constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  public async fetch(
    config: AlphaVantageStockConfig,
    signal?: AbortSignal,
  ): Promise<WatchItem[]> {
    const symbol = config.symbol.trim().toUpperCase();
    const url = new URL('https://www.alphavantage.co/query');
    url.search = new URLSearchParams({
      function: 'REALTIME_OPTIONS',
      symbol,
      require_greeks: 'true',
      apikey: this.apiKey,
    }).toString();
    const rows = await checkedRows(this.fetcher, url, signal);
    if (rows.length === 0) return [];

    let callVolume = 0;
    let putVolume = 0;
    let callOpenInterest = 0;
    let putOpenInterest = 0;
    let maxVolumeOiRatio: number | null = null;
    const impliedVolatilities: number[] = [];
    let latestDate: string | null = null;
    let largestContract: Record<string, unknown> | null = null;

    for (const row of rows) {
      const type = (
        stringValue(row, 'type', 'option_type') ?? ''
      ).toLowerCase();
      const volume = numericValue(row, 'volume') ?? 0;
      const openInterest =
        numericValue(row, 'open_interest', 'openInterest') ?? 0;
      const impliedVolatility = numericValue(
        row,
        'implied_volatility',
        'impliedVolatility',
      );
      if (type === 'call') {
        callVolume += volume;
        callOpenInterest += openInterest;
      } else if (type === 'put') {
        putVolume += volume;
        putOpenInterest += openInterest;
      }
      if (impliedVolatility !== null)
        impliedVolatilities.push(impliedVolatility);
      const ratio = openInterest > 0 ? volume / openInterest : null;
      if (
        ratio !== null &&
        (maxVolumeOiRatio === null || ratio > maxVolumeOiRatio)
      ) {
        maxVolumeOiRatio = ratio;
        largestContract = {
          contractId: stringValue(row, 'contractID', 'contract_id'),
          expiration: stringValue(row, 'expiration'),
          strike: numericValue(row, 'strike'),
          type,
          volume,
          openInterest,
          volumeOiRatio: ratio,
        };
      }
      const rowDate = stringValue(row, 'date', 'trade_date');
      if (rowDate && (!latestDate || rowDate > latestDate))
        latestDate = rowDate;
    }

    const observedAt = parseDate(latestDate) ?? new Date();
    const facts = {
      callVolume: Math.round(callVolume),
      putVolume: Math.round(putVolume),
      callOpenInterest: Math.round(callOpenInterest),
      putOpenInterest: Math.round(putOpenInterest),
      putCallVolumeRatio: callVolume > 0 ? putVolume / callVolume : null,
      putCallOpenInterestRatio:
        callOpenInterest > 0 ? putOpenInterest / callOpenInterest : null,
      meanImpliedVolatility:
        impliedVolatilities.length > 0
          ? impliedVolatilities.reduce((sum, value) => sum + value, 0) /
            impliedVolatilities.length
          : null,
      maxVolumeOiRatio,
      largestContract,
      contractCount: rows.length,
    };
    const externalId = `${symbol}:${observedAt.toISOString().slice(0, 10)}:${hash(facts).slice(0, 16)}`;
    return [
      {
        id: `${this.id}:${externalId}`,
        source: this.id,
        externalId,
        title: `${symbol} options positioning snapshot`,
        url: `https://www.alphavantage.co/options/?symbol=${encodeURIComponent(symbol)}`,
        publishedAt: observedAt,
        eventAt: observedAt,
        content: `Calls: ${facts.callVolume} volume / ${facts.callOpenInterest} open interest. Puts: ${facts.putVolume} volume / ${facts.putOpenInterest} open interest. Put/call volume ratio: ${facts.putCallVolumeRatio ?? 'n/a'}. Highest contract volume/open-interest ratio: ${maxVolumeOiRatio ?? 'n/a'}.`,
        sourceType: 'MARKET_DATA',
        primarySource: false,
        category: 'OPTIONS_SNAPSHOT',
        normalizedFacts: facts,
        entities: [symbol],
        reliability: 0.75,
        metadata: {
          symbol,
          provider: 'Alpha Vantage',
          contractCount: rows.length,
        },
      },
    ];
  }
}

export class AlphaVantageInstitutionalSource implements Source<AlphaVantageStockConfig> {
  public readonly id = 'ALPHA_VANTAGE_INSTITUTIONAL';
  public readonly capabilities = {
    sourceName: 'Alpha Vantage institutional holdings',
    sourceType: 'MARKET_DATA' as const,
    minimumIntervalMs: 6 * 60 * 60_000,
    preferredIntervalMs: 24 * 60 * 60_000,
    maximumIntervalMs: 7 * 24 * 60 * 60_000,
    supportsStreaming: false,
    costPerRequestUsd: 0,
    rateLimitPerMinute: null,
    priority: 60,
    requestPolicy: {
      providerKey: 'ALPHA_VANTAGE',
      maxConcurrency: 1,
      minimumSpacingMs: 1_100,
      sharedRateLimitBackoff: true,
    },
  };

  public constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  public async fetch(
    config: AlphaVantageStockConfig,
    signal?: AbortSignal,
  ): Promise<WatchItem[]> {
    const symbol = config.symbol.trim().toUpperCase();
    const url = new URL('https://www.alphavantage.co/query');
    url.search = new URLSearchParams({
      function: 'INSTITUTIONAL_HOLDINGS',
      symbol,
      apikey: this.apiKey,
    }).toString();
    const rows = await checkedRows(this.fetcher, url, signal);
    if (rows.length === 0) return [];
    const latestDateText =
      rows
        .map((row) => stringValue(row, 'date', 'report_date', 'reported_at'))
        .filter((value): value is string => value !== null)
        .sort()
        .at(-1) ?? null;
    const latestRows = latestDateText
      ? rows.filter(
          (row) =>
            stringValue(row, 'date', 'report_date', 'reported_at') ===
            latestDateText,
        )
      : rows;
    const aggregate = latestRows[0] ?? {};
    const totalShares =
      numericValue(aggregate, 'total_shares', 'totalShares') ??
      latestRows.reduce(
        (sum, row) =>
          sum + (numericValue(row, 'shares', 'shares_held', 'sharesHeld') ?? 0),
        0,
      );
    const totalValueUsd =
      numericValue(
        aggregate,
        'total_value',
        'totalValue',
        'market_value',
        'marketValue',
      ) ??
      latestRows.reduce(
        (sum, row) =>
          sum +
          (numericValue(row, 'value', 'market_value', 'marketValue') ?? 0),
        0,
      );
    const netShareChange =
      numericValue(
        aggregate,
        'net_share_change',
        'netShareChange',
        'change',
        'changeInShares',
      ) ??
      latestRows.reduce(
        (sum, row) =>
          sum +
          (numericValue(row, 'change', 'share_change', 'changeInShares') ?? 0),
        0,
      );
    const reportedChangePercent = numericValue(
      aggregate,
      'change_percent',
      'changePercent',
      'percent_change',
      'changeInSharesPercentage',
    );
    const previousShares = totalShares - netShareChange;
    const changePercent =
      reportedChangePercent ??
      (previousShares > 0 ? (netShareChange / previousShares) * 100 : null);
    const holderCount =
      latestRows.reduce(
        (sum, row) =>
          sum +
          (numericValue(row, 'holder_count', 'holderCount', 'holders') ?? 0),
        0,
      ) || latestRows.length;
    const topHolders = latestRows
      .map((row) => ({
        holder: stringValue(
          row,
          'holder',
          'holder_name',
          'institution',
          'holderType',
        ),
        shares: numericValue(row, 'shares', 'shares_held', 'sharesHeld'),
        valueUsd: numericValue(row, 'value', 'market_value', 'marketValue'),
        change: numericValue(row, 'change', 'share_change', 'changeInShares'),
      }))
      .filter(({ holder }) => holder)
      .slice(0, Math.max(1, Math.min(config.maxItems ?? 5, 20)));
    const reportedAt = parseDate(latestDateText) ?? new Date();
    const facts = {
      totalShares,
      totalValueUsd,
      netShareChange,
      changePercent,
      holderCount: Math.round(holderCount),
      topHolders,
    };
    const externalId = `${symbol}:${reportedAt.toISOString().slice(0, 10)}:${hash(facts).slice(0, 16)}`;
    return [
      {
        id: `${this.id}:${externalId}`,
        source: this.id,
        externalId,
        title: `${symbol} institutional positioning snapshot`,
        url: 'https://www.alphavantage.co/documentation/',
        publishedAt: reportedAt,
        eventAt: reportedAt,
        content: `Institutional holders: ${Math.round(holderCount)}. Total shares: ${totalShares || 'n/a'}. Net share change: ${netShareChange || 'n/a'}. Reported change: ${changePercent ?? 'n/a'}%.`,
        sourceType: 'MARKET_DATA',
        primarySource: false,
        category: 'INSTITUTIONAL_POSITIONING',
        normalizedFacts: facts,
        entities: [
          symbol,
          ...topHolders.flatMap(({ holder }) => (holder ? [holder] : [])),
        ],
        reliability: 0.75,
        metadata: { symbol, provider: 'Alpha Vantage' },
      },
    ];
  }
}
