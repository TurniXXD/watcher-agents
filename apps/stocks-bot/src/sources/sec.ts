import type { Source, WatchItem } from '@watcher/core';
import { z } from 'zod';
import { fetchText, stripHtml } from './utils/http.js';

const tickersSchema = z.record(
  z.string(),
  z.object({ cik_str: z.number(), ticker: z.string(), title: z.string() }),
);
const submissionsSchema = z.object({
  name: z.string(),
  tickers: z.array(z.string()).optional(),
  exchanges: z.array(z.string()).optional(),
  sicDescription: z.string().optional(),
  website: z.string().optional(),
  investorWebsite: z.string().optional(),
  filings: z.object({
    recent: z.object({
      accessionNumber: z.array(z.string()),
      filingDate: z.array(z.string()),
      form: z.array(z.string()),
      primaryDocument: z.array(z.string()),
      primaryDocDescription: z.array(z.string()),
    }),
  }),
});

export type SecConfig = { symbol: string; cik?: string; maxItems?: number };
export type SecCompany = { symbol: string; companyName: string; cik: string };
export type SecCompanyProfile = SecCompany & {
  exchange: string | null;
  industry: string | null;
  investorRelationsUrl: string | null;
};

const filingCategory = (form: string): string => {
  if (form === '4' || form === '144') {
    return 'INSIDER_TRANSACTION';
  }
  if (form === '10-Q' || form === '10-K') {
    return 'EARNINGS';
  }
  if (form === '8-K') {
    return 'COMPANY_EVENT';
  }
  if (form === '13D' || form === '13G') {
    return 'OWNERSHIP';
  }
  return 'REGULATORY';
};

const xmlValue = (xml: string, tag: string): string | undefined => {
  const match = xml.match(
    new RegExp(
      `<(?:[a-z0-9_-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-z0-9_-]+:)?${tag}>`,
      'i',
    ),
  );
  if (!match?.[1]) return undefined;
  const nested = match[1].match(/<value\b[^>]*>([\s\S]*?)<\/value>/i)?.[1];
  return stripHtml(nested ?? match[1]).trim() || undefined;
};

const form4Facts = (document: string): Record<string, unknown> => {
  const ownerBlock =
    document.match(
      /<reportingOwner\b[^>]*>([\s\S]*?)<\/reportingOwner>/i,
    )?.[1] ?? document;
  const transactionBlock =
    document.match(
      /<(?:nonDerivativeTransaction|derivativeTransaction)\b[^>]*>([\s\S]*?)<\/(?:nonDerivativeTransaction|derivativeTransaction)>/i,
    )?.[1] ?? document;
  const footnotes = [
    ...document.matchAll(/<footnote\b[^>]*>([\s\S]*?)<\/footnote>/gi),
  ]
    .map((match) => stripHtml(match[1] ?? '').trim())
    .filter(Boolean)
    .join(' ');
  const booleanValue = (tag: string): boolean | undefined => {
    const raw = xmlValue(ownerBlock, tag)?.toLowerCase();
    if (!raw) return undefined;
    return raw === '1' || raw === 'true';
  };
  return {
    owner: xmlValue(ownerBlock, 'rptOwnerName'),
    officerTitle: xmlValue(ownerBlock, 'officerTitle'),
    isDirector: booleanValue('isDirector'),
    isOfficer: booleanValue('isOfficer'),
    isTenPercentOwner: booleanValue('isTenPercentOwner'),
    transactionDate: xmlValue(transactionBlock, 'transactionDate'),
    transactionCode: xmlValue(transactionBlock, 'transactionCode'),
    acquiredDisposedCode: xmlValue(
      transactionBlock,
      'transactionAcquiredDisposedCode',
    ),
    shares: xmlValue(transactionBlock, 'transactionShares'),
    pricePerShare: xmlValue(transactionBlock, 'transactionPricePerShare'),
    sharesOwnedFollowing: xmlValue(
      transactionBlock,
      'sharesOwnedFollowingTransaction',
    ),
    footnotes: footnotes || undefined,
  };
};

export class SecEdgarSource implements Source<SecConfig> {
  public readonly id = 'SEC';
  public readonly capabilities = {
    sourceName: 'SEC EDGAR',
    sourceType: 'REGULATORY' as const,
    minimumIntervalMs: 60_000,
    preferredIntervalMs: 5 * 60_000,
    maximumIntervalMs: 60 * 60_000,
    supportsStreaming: false,
    costPerRequestUsd: 0,
    rateLimitPerMinute: 600,
    priority: 100,
  };
  #tickerCache: z.infer<typeof tickersSchema> | undefined;
  readonly #submissionCache = new Map<
    string,
    { expiresAt: number; value: z.infer<typeof submissionsSchema> }
  >();

  public constructor(
    private readonly userAgent: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (!userAgent.trim()) {
      throw new Error('SEC_USER_AGENT is required');
    }
  }

  async #loadTickerCache(signal?: AbortSignal): Promise<void> {
    if (!this.#tickerCache) {
      const text = await fetchText(
        this.fetcher,
        'https://www.sec.gov/files/company_tickers.json',
        { 'user-agent': this.userAgent, accept: 'application/json' },
        signal,
      );
      this.#tickerCache = tickersSchema.parse(JSON.parse(text));
    }
  }

  public async lookupCompany(
    symbol: string,
    signal?: AbortSignal,
  ): Promise<SecCompany> {
    await this.#loadTickerCache(signal);
    const tickerCache = this.#tickerCache;
    if (!tickerCache) {
      throw new Error('SEC ticker cache is unavailable');
    }
    const normalized = symbol.trim().toUpperCase();
    const match = Object.values(tickerCache).find(
      (company) => company.ticker.toUpperCase() === normalized,
    );
    if (!match) {
      throw new Error(`No SEC CIK found for ${symbol}`);
    }
    return {
      symbol: match.ticker.toUpperCase(),
      companyName: match.title,
      cik: String(match.cik_str).padStart(10, '0'),
    };
  }

  async #cikFor(symbol: string, signal?: AbortSignal): Promise<string> {
    return (await this.lookupCompany(symbol, signal)).cik;
  }

  async #submissionFor(
    cik: string,
    signal?: AbortSignal,
  ): Promise<z.infer<typeof submissionsSchema>> {
    const normalizedCik = cik.padStart(10, '0');
    const cached = this.#submissionCache.get(normalizedCik);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    const text = await fetchText(
      this.fetcher,
      `https://data.sec.gov/submissions/CIK${normalizedCik}.json`,
      { 'user-agent': this.userAgent, accept: 'application/json' },
      signal,
    );
    const submission = submissionsSchema.parse(JSON.parse(text));
    this.#submissionCache.set(normalizedCik, {
      expiresAt: Date.now() + 60_000,
      value: submission,
    });
    return submission;
  }

  public async lookupCompanyProfile(
    symbol: string,
    signal?: AbortSignal,
  ): Promise<SecCompanyProfile> {
    const company = await this.lookupCompany(symbol, signal);
    const submission = await this.#submissionFor(company.cik, signal);
    const tickerIndex = Math.max(
      0,
      submission.tickers?.findIndex(
        (ticker) => ticker.toUpperCase() === company.symbol,
      ) ?? 0,
    );
    const investorRelationsUrl =
      submission.investorWebsite?.trim() || submission.website?.trim() || null;
    return {
      ...company,
      exchange: submission.exchanges?.[tickerIndex] || null,
      industry: submission.sicDescription?.trim() || null,
      investorRelationsUrl,
    };
  }

  public async fetch(
    config: SecConfig,
    signal?: AbortSignal,
  ): Promise<WatchItem[]> {
    const cik = (
      config.cik ?? (await this.#cikFor(config.symbol, signal))
    ).padStart(10, '0');
    const submission = await this.#submissionFor(cik, signal);
    const recent = submission.filings.recent;
    const maxItems = Math.min(config.maxItems ?? 5, 10);
    const items: WatchItem[] = [];

    for (
      let index = 0;
      index < Math.min(recent.accessionNumber.length, maxItems);
      index += 1
    ) {
      const accession = recent.accessionNumber[index];
      const primaryDocument = recent.primaryDocument[index];
      const form = recent.form[index];
      if (!accession || !primaryDocument || !form) {
        continue;
      }
      const accessionPlain = accession.replaceAll('-', '');
      const documentUrl = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionPlain}/${primaryDocument}`;
      await new Promise((resolve) => setTimeout(resolve, 120));
      const rawDocument = await fetchText(
        this.fetcher,
        documentUrl,
        {
          'user-agent': this.userAgent,
          accept: 'text/html,application/xhtml+xml',
        },
        signal,
      );
      const document = stripHtml(rawDocument).slice(0, 80_000);
      const description =
        recent.primaryDocDescription[index] || `${form} filing`;
      items.push({
        id: `SEC:${accession}`,
        source: this.id,
        externalId: accession,
        title: `${submission.name}: ${description}`,
        url: documentUrl,
        publishedAt: recent.filingDate[index]
          ? new Date(`${recent.filingDate[index]}T00:00:00Z`)
          : undefined,
        content: document || `${form} filed by ${submission.name}`,
        sourceType: 'REGULATORY',
        primarySource: true,
        eventAt: recent.filingDate[index]
          ? new Date(`${recent.filingDate[index]}T00:00:00Z`)
          : undefined,
        category: filingCategory(form),
        normalizedFacts: {
          form,
          accession,
          cik,
          ...(form === '4' ? form4Facts(rawDocument) : {}),
        },
        entities: [submission.name, config.symbol.toUpperCase()],
        reliability: 1,
        metadata: { symbol: config.symbol, cik, form, accession },
      });
    }
    return items;
  }
}
