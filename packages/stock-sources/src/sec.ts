import type { Source, WatchItem } from '@watcher/core';
import { z } from 'zod';
import { fetchText, stripHtml } from './http.js';

const tickersSchema = z.record(
  z.string(),
  z.object({ cik_str: z.number(), ticker: z.string(), title: z.string() }),
);
const submissionsSchema = z.object({
  name: z.string(),
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

export class SecEdgarSource implements Source<SecConfig> {
  public readonly id = 'SEC';
  #tickerCache: z.infer<typeof tickersSchema> | undefined;

  public constructor(
    private readonly userAgent: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (!userAgent.trim()) throw new Error('SEC_USER_AGENT is required');
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
    if (!tickerCache) throw new Error('SEC ticker cache is unavailable');
    const normalized = symbol.trim().toUpperCase();
    const match = Object.values(tickerCache).find(
      (company) => company.ticker.toUpperCase() === normalized,
    );
    if (!match) throw new Error(`No SEC CIK found for ${symbol}`);
    return {
      symbol: match.ticker.toUpperCase(),
      companyName: match.title,
      cik: String(match.cik_str).padStart(10, '0'),
    };
  }

  async #cikFor(symbol: string, signal?: AbortSignal): Promise<string> {
    return (await this.lookupCompany(symbol, signal)).cik;
  }

  public async fetch(
    config: SecConfig,
    signal?: AbortSignal,
  ): Promise<WatchItem[]> {
    const cik = (
      config.cik ?? (await this.#cikFor(config.symbol, signal))
    ).padStart(10, '0');
    const text = await fetchText(
      this.fetcher,
      `https://data.sec.gov/submissions/CIK${cik}.json`,
      { 'user-agent': this.userAgent, accept: 'application/json' },
      signal,
    );
    const submission = submissionsSchema.parse(JSON.parse(text));
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
      if (!accession || !primaryDocument || !form) continue;
      const accessionPlain = accession.replaceAll('-', '');
      const documentUrl = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionPlain}/${primaryDocument}`;
      await new Promise((resolve) => setTimeout(resolve, 120));
      const document = stripHtml(
        await fetchText(
          this.fetcher,
          documentUrl,
          {
            'user-agent': this.userAgent,
            accept: 'text/html,application/xhtml+xml',
          },
          signal,
        ),
      ).slice(0, 80_000);
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
        metadata: { symbol: config.symbol, cik, form, accession },
      });
    }
    return items;
  }
}
