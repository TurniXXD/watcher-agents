import { createHash } from 'node:crypto';
import {
  parseDate,
  sourceHttpError,
  type Source,
  type WatchItem,
} from '@watcher/core';
import { z } from 'zod';

export type QuiverConfig = { symbol: string; maxItems?: number };

const optionalString = z.string().nullish();
const optionalNumber = z.number().nullish();

const insiderSchema = z.object({
  Ticker: optionalString,
  Date: z.string().min(1),
  Name: z.string().min(1),
  AcquiredDisposedCode: z.string().min(1),
  TransactionCode: z.string().min(1),
  Shares: optionalNumber,
  PricePerShare: optionalNumber,
  SharesOwnedFollowing: optionalNumber,
  fileDate: z.string().min(1),
  officerTitle: optionalString,
  isDirector: z.boolean().nullish(),
  isOfficer: z.boolean().nullish(),
  isTenPercentOwner: z.boolean().nullish(),
  isOther: z.boolean().nullish(),
  directOrIndirectOwnership: optionalString,
  uploaded: optionalString,
});

const contractSchema = z.object({
  Ticker: z.string().min(1),
  Amount: z.string().min(1),
  Qtr: z.number().int().min(1).max(4),
  Year: z.number().int().min(1900).max(2200),
});

const patentSchema = z.object({
  Date: z.string().min(1),
  IPC: optionalString,
  Title: optionalString,
  Claims: optionalNumber,
  Abstract: optionalString,
  Ticker: z.string().min(1),
  PatentNumber: z.string().min(1),
});

const congressSchema = z.object({
  Representative: z.string().min(1),
  BioGuideID: optionalString,
  ReportDate: optionalString,
  TransactionDate: optionalString,
  Ticker: optionalString,
  Transaction: optionalString,
  Range: optionalString,
  District: optionalString,
  House: optionalString,
  Amount: optionalString,
  Party: z.string().min(1),
  last_modified: optionalString,
  TickerType: optionalString,
  Description: optionalString,
});

const offExchangeSchema = z.object({
  Ticker: z.string().min(1),
  Date: z.string().min(1),
  OTC_Short: z.number().int().nonnegative(),
  OTC_Total: z.number().int().nonnegative(),
  DPI: z.number().nonnegative(),
});

const lobbyingSchema = z
  .object({
    Ticker: optionalString,
    Date: optionalString,
    Client: optionalString,
    Registrant: optionalString,
    Amount: z.union([z.string(), z.number()]).nullish(),
    Issue: optionalString,
    SpecificIssue: optionalString,
    ReportType: optionalString,
  })
  .loose();

type QuiverDataset =
  | 'QUIVER_INSIDERS'
  | 'QUIVER_CONTRACTS'
  | 'QUIVER_PATENTS'
  | 'QUIVER_CONGRESS'
  | 'QUIVER_OFF_EXCHANGE'
  | 'QUIVER_LOBBYING';

const datasetSchema = {
  QUIVER_INSIDERS: z.array(insiderSchema),
  QUIVER_CONTRACTS: z.array(contractSchema),
  QUIVER_PATENTS: z.array(patentSchema),
  QUIVER_CONGRESS: z.array(congressSchema),
  QUIVER_OFF_EXCHANGE: z.array(offExchangeSchema),
  QUIVER_LOBBYING: z.array(lobbyingSchema),
} as const;

const idFor = (...parts: Array<string | number | null | undefined>): string =>
  createHash('sha256')
    .update(parts.map((part) => String(part ?? '')).join('\u0000'))
    .digest('hex');

const value = (input: string | number | null | undefined): string =>
  input === null || input === undefined || input === ''
    ? 'not reported'
    : String(input);

export class QuiverSource implements Source<QuiverConfig> {
  public constructor(
    public readonly id: QuiverDataset,
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  public get capabilities() {
    return {
      sourceName: `Quiver Quantitative ${this.id.replace('QUIVER_', '').toLowerCase()}`,
      sourceType:
        this.id === 'QUIVER_INSIDERS'
          ? ('OTHER' as const)
          : this.id === 'QUIVER_CONGRESS'
            ? ('NEWS' as const)
            : this.id === 'QUIVER_LOBBYING'
              ? ('OTHER' as const)
              : ('MARKET_DATA' as const),
      minimumIntervalMs: 15 * 60_000,
      preferredIntervalMs:
        this.id === 'QUIVER_OFF_EXCHANGE' ? 24 * 60 * 60_000 : 6 * 60 * 60_000,
      maximumIntervalMs: 7 * 24 * 60 * 60_000,
      supportsStreaming: false,
      costPerRequestUsd: 0,
      rateLimitPerMinute: null,
      priority: 55,
      requestPolicy: {
        providerKey: 'QUIVER',
        maxConcurrency: 1,
        minimumSpacingMs: 1_000,
        sharedRateLimitBackoff: true,
      },
    };
  }

  private endpoint(symbol: string, maxItems: number): string {
    if (this.id === 'QUIVER_INSIDERS') {
      const query = new URLSearchParams({
        ticker: symbol,
        page_size: String(maxItems),
      });
      return `https://api.quiverquant.com/beta/live/insiders?${query}`;
    }
    const path = {
      QUIVER_CONTRACTS: 'govcontracts',
      QUIVER_PATENTS: 'allpatents',
      QUIVER_CONGRESS: 'congresstrading',
      QUIVER_OFF_EXCHANGE: 'offexchange',
      QUIVER_LOBBYING: 'lobbying',
    }[this.id];
    return `https://api.quiverquant.com/beta/historical/${path}/${encodeURIComponent(symbol)}`;
  }

  public async fetch(
    config: QuiverConfig,
    signal?: AbortSignal,
  ): Promise<WatchItem[]> {
    const symbol = config.symbol.trim().toUpperCase();
    const maxItems = Math.max(0, Math.min(config.maxItems ?? 5, 50));
    const response = await this.fetcher(this.endpoint(symbol, maxItems), {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${this.token}`,
      },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw sourceHttpError(response, this.endpoint(symbol, maxItems));
    const rows = datasetSchema[this.id].parse(await response.json());
    return this.normalize(symbol, rows)
      .sort(
        (left, right) =>
          (right.publishedAt?.getTime() ?? 0) -
          (left.publishedAt?.getTime() ?? 0),
      )
      .slice(0, maxItems);
  }

  private normalize(symbol: string, rows: unknown[]): WatchItem[] {
    const providerUrl = `https://www.quiverquant.com/stock/${encodeURIComponent(symbol)}`;
    if (this.id === 'QUIVER_INSIDERS') {
      return (rows as z.infer<typeof insiderSchema>[]).map((row) => {
        const externalId = idFor(
          symbol,
          row.Name,
          row.Date,
          row.TransactionCode,
          row.Shares,
          row.PricePerShare,
        );
        const transactionValue =
          row.Shares != null && row.PricePerShare != null
            ? row.Shares * row.PricePerShare
            : null;
        return {
          id: `${this.id}:${externalId}`,
          source: this.id,
          externalId,
          title: `${symbol} Form 4 transaction: ${row.Name}`,
          url: providerUrl,
          publishedAt: parseDate(row.fileDate),
          content: [
            `Insider: ${row.Name}`,
            `Role: ${value(row.officerTitle)}`,
            `Transaction date: ${row.Date}`,
            `Transaction code: ${row.TransactionCode}`,
            `Acquired/disposed: ${row.AcquiredDisposedCode}`,
            `Shares: ${value(row.Shares)}`,
            `Price per share: ${value(row.PricePerShare)}`,
            `Holdings after: ${value(row.SharesOwnedFollowing)}`,
          ].join('\n'),
          sourceType: 'OTHER',
          primarySource: false,
          category: 'INSIDER_TRANSACTION',
          normalizedFacts: {
            owner: row.Name,
            officerTitle: row.officerTitle,
            transactionDate: row.Date,
            transactionCode: row.TransactionCode,
            acquiredDisposedCode: row.AcquiredDisposedCode,
            shares: row.Shares,
            pricePerShare: row.PricePerShare,
            transactionValue,
            sharesOwnedFollowing: row.SharesOwnedFollowing,
            isDirector: row.isDirector,
            isOfficer: row.isOfficer,
            isTenPercentOwner: row.isTenPercentOwner,
          },
          entities: [symbol, row.Name],
          reliability: 0.75,
          metadata: {
            symbol,
            dataset: this.id,
            provider: 'Quiver Quantitative',
          },
        };
      });
    }
    if (this.id === 'QUIVER_CONTRACTS') {
      return (rows as z.infer<typeof contractSchema>[]).map((row) => {
        const externalId = idFor(symbol, row.Year, row.Qtr, row.Amount);
        const occurredAt = new Date(Date.UTC(row.Year, (row.Qtr - 1) * 3, 1));
        return {
          id: `${this.id}:${externalId}`,
          source: this.id,
          externalId,
          title: `${symbol} government contract activity Q${row.Qtr} ${row.Year}`,
          url: providerUrl,
          publishedAt: occurredAt,
          content: `Quiver-reported government contract obligations: $${row.Amount} in Q${row.Qtr} ${row.Year}.`,
          sourceType: 'MARKET_DATA',
          primarySource: false,
          category: 'GOVERNMENT_CONTRACT',
          normalizedFacts: {
            contractValueUsd: row.Amount,
            quarter: row.Qtr,
            year: row.Year,
          },
          entities: [symbol],
          reliability: 0.7,
          metadata: {
            symbol,
            dataset: this.id,
            provider: 'Quiver Quantitative',
          },
        };
      });
    }
    if (this.id === 'QUIVER_PATENTS') {
      return (rows as z.infer<typeof patentSchema>[]).map((row) => {
        const externalId = idFor(symbol, row.PatentNumber);
        return {
          id: `${this.id}:${externalId}`,
          source: this.id,
          externalId,
          title: row.Title?.trim() || `${symbol} patent ${row.PatentNumber}`,
          url: `https://patents.google.com/patent/${encodeURIComponent(row.PatentNumber)}`,
          publishedAt: parseDate(row.Date),
          content: [
            `Patent number: ${row.PatentNumber}`,
            `IPC: ${value(row.IPC)}`,
            `Claims: ${value(row.Claims)}`,
            `Abstract: ${value(row.Abstract)}`,
          ].join('\n'),
          sourceType: 'MARKET_DATA',
          primarySource: false,
          category: 'PATENT',
          normalizedFacts: {
            patentNumber: row.PatentNumber,
            ipc: row.IPC,
            claims: row.Claims,
          },
          entities: [symbol],
          reliability: 0.7,
          metadata: {
            symbol,
            dataset: this.id,
            provider: 'Quiver Quantitative',
          },
        };
      });
    }
    if (this.id === 'QUIVER_CONGRESS') {
      return (rows as z.infer<typeof congressSchema>[]).map((row) => {
        const externalId = idFor(
          symbol,
          row.Representative,
          row.TransactionDate,
          row.Transaction,
          row.Range,
        );
        return {
          id: `${this.id}:${externalId}`,
          source: this.id,
          externalId,
          title: `${row.Representative} reported ${value(row.Transaction)} in ${symbol}`,
          url: providerUrl,
          publishedAt: parseDate(row.ReportDate),
          content: [
            `Representative: ${row.Representative}`,
            `Transaction date: ${value(row.TransactionDate)}`,
            `Report date: ${value(row.ReportDate)}`,
            `Transaction: ${value(row.Transaction)}`,
            `Reported range: ${value(row.Range)}`,
            `House: ${value(row.House)}`,
            `Party: ${row.Party}`,
          ].join('\n'),
          sourceType: 'NEWS',
          primarySource: false,
          category: 'CONGRESSIONAL_TRANSACTION',
          normalizedFacts: {
            representative: row.Representative,
            transactionDate: row.TransactionDate,
            reportDate: row.ReportDate,
            transaction: row.Transaction,
            range: row.Range,
            amount: row.Amount,
          },
          entities: [symbol, row.Representative],
          reliability: 0.7,
          metadata: {
            symbol,
            dataset: this.id,
            provider: 'Quiver Quantitative',
          },
        };
      });
    }
    if (this.id === 'QUIVER_LOBBYING') {
      return (rows as z.infer<typeof lobbyingSchema>[]).map((row) => {
        const date = row.Date ?? 'unknown-date';
        const client = row.Client ?? symbol;
        const issue = row.SpecificIssue ?? row.Issue;
        const externalId = idFor(
          symbol,
          date,
          client,
          row.Registrant,
          row.Amount,
          issue,
        );
        return {
          id: `${this.id}:${externalId}`,
          source: this.id,
          externalId,
          title: `${symbol} lobbying disclosure${issue ? `: ${issue}` : ''}`,
          url: providerUrl,
          publishedAt: parseDate(row.Date),
          content: [
            `Client: ${client}`,
            `Registrant: ${value(row.Registrant)}`,
            `Reported amount: ${value(row.Amount)}`,
            `Issue: ${value(issue)}`,
            `Report type: ${value(row.ReportType)}`,
          ].join('\n'),
          sourceType: 'OTHER',
          primarySource: false,
          category: 'LOBBYING_DISCLOSURE',
          normalizedFacts: {
            client,
            registrant: row.Registrant,
            amount: row.Amount,
            issue,
            reportType: row.ReportType,
          },
          entities: [symbol, client],
          reliability: 0.7,
          metadata: {
            symbol,
            dataset: this.id,
            provider: 'Quiver Quantitative',
          },
        };
      });
    }
    return (rows as z.infer<typeof offExchangeSchema>[]).map((row) => {
      const externalId = idFor(symbol, row.Date, row.OTC_Short, row.OTC_Total);
      return {
        id: `${this.id}:${externalId}`,
        source: this.id,
        externalId,
        title: `${symbol} off-exchange volume ${row.Date.slice(0, 10)}`,
        url: providerUrl,
        publishedAt: parseDate(row.Date),
        content: `Off-exchange short volume ${row.OTC_Short} of ${row.OTC_Total}; DPI ${row.DPI}.`,
        sourceType: 'MARKET_DATA',
        primarySource: false,
        category: 'OFF_EXCHANGE_SNAPSHOT',
        normalizedFacts: {
          shortVolume: row.OTC_Short,
          totalVolume: row.OTC_Total,
          dpi: row.DPI,
        },
        entities: [symbol],
        reliability: 0.7,
        metadata: { symbol, dataset: this.id, provider: 'Quiver Quantitative' },
      };
    });
  }
}
