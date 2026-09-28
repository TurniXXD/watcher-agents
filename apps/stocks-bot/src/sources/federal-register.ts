import { parseDate, type Source, type WatchItem } from '@watcher/core';
import { z } from 'zod';
import { companyMention } from './company-mention.js';
import { fetchText, normalizeWhitespace, stripHtml } from './utils/http.js';

export type FederalRegisterConfig = {
  symbol: string;
  companyName?: string | null;
  maxItems?: number;
};

const agencySchema = z.object({ name: z.string(), slug: z.string() });
const documentSchema = z.object({
  document_number: z.string().min(1),
  title: z.string().min(1),
  abstract: z.string().nullable().optional(),
  excerpts: z.string().nullable().optional(),
  html_url: z.url(),
  publication_date: z.iso.date(),
  type: z.string().optional(),
  agencies: z.array(agencySchema),
});
const responseSchema = z.object({ results: z.array(documentSchema) });

const relevantAgencySlugs = new Set([
  'international-trade-commission',
  'federal-trade-commission',
  'justice-department',
  'commerce-department',
  'industry-and-security-bureau',
  'foreign-assets-control-office',
  'treasury-department',
  'food-and-drug-administration',
  'patent-and-trademark-office',
]);

const documentTextUrl = (date: string, number: string): string => {
  const [year, month, day] = date.split('-');
  return `https://www.federalregister.gov/documents/full_text/text/${year}/${month}/${day}/${encodeURIComponent(number)}.txt`;
};

const relevantExcerpt = (text: string, companyName: string): string => {
  const normalized = normalizeWhitespace(text);
  const firstToken = companyName.match(/[A-Za-z0-9]+/)?.[0]?.toLowerCase();
  const position = firstToken
    ? normalized.toLowerCase().indexOf(firstToken)
    : -1;
  const start = Math.max(0, position - 300);
  return normalized.slice(start, start + 2_400);
};

export class FederalRegisterSource implements Source<FederalRegisterConfig> {
  public readonly id = 'FEDERAL_REGISTER';
  public readonly capabilities = {
    sourceName: 'Federal Register official regulatory notices',
    sourceType: 'REGULATORY' as const,
    minimumIntervalMs: 15 * 60_000,
    preferredIntervalMs: 60 * 60_000,
    maximumIntervalMs: 24 * 60 * 60_000,
    supportsStreaming: false,
    costPerRequestUsd: 0,
    rateLimitPerMinute: null,
    priority: 98,
    requestPolicy: {
      providerKey: 'federal-register',
      maxConcurrency: 1,
      minimumSpacingMs: 1_000,
      sharedRateLimitBackoff: true,
    },
  };
  readonly #textCache = new Map<string, string>();
  readonly #searchCache = new Map<
    string,
    { expiresAt: number; documents: z.infer<typeof documentSchema>[] }
  >();

  public constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly onDocumentError?: (
      documentNumber: string,
      error: unknown,
    ) => void,
  ) {}

  public async fetch(
    config: FederalRegisterConfig,
    signal?: AbortSignal,
  ): Promise<WatchItem[]> {
    const companyName = config.companyName?.trim();
    if (!companyName) return [];
    const symbol = config.symbol.trim().toUpperCase();
    const maxItems = Math.max(1, Math.min(config.maxItems ?? 5, 10));
    const earliest = new Date(Date.now() - 90 * 24 * 60 * 60_000)
      .toISOString()
      .slice(0, 10);
    const url = new URL(
      'https://www.federalregister.gov/api/v1/documents.json',
    );
    url.searchParams.set('conditions[term]', companyName);
    url.searchParams.set('conditions[publication_date][gte]', earliest);
    url.searchParams.set('order', 'newest');
    url.searchParams.set('per_page', '20');
    const cached = this.#searchCache.get(companyName);
    const documents =
      cached && cached.expiresAt > Date.now()
        ? cached.documents
        : responseSchema.parse(
            JSON.parse(
              await fetchText(
                this.fetcher,
                url.toString(),
                { accept: 'application/json' },
                signal,
              ),
            ),
          ).results;
    if (!cached || cached.expiresAt <= Date.now()) {
      this.#searchCache.set(companyName, {
        expiresAt: Date.now() + 15 * 60_000,
        documents,
      });
    }
    const candidates = documents
      .filter((document) => {
        const documentUrl = new URL(document.html_url);
        return (
          documentUrl.protocol === 'https:' &&
          documentUrl.hostname === 'www.federalregister.gov' &&
          document.agencies.some((agency) =>
            relevantAgencySlugs.has(agency.slug),
          )
        );
      })
      .slice(0, 12);
    const items: WatchItem[] = [];
    let successfulDocuments = 0;
    let firstError: unknown;
    for (const document of candidates) {
      if (items.length >= maxItems) break;
      let fullText: string;
      try {
        fullText =
          this.#textCache.get(document.document_number) ??
          (await fetchText(
            this.fetcher,
            documentTextUrl(
              document.publication_date,
              document.document_number,
            ),
            { accept: 'text/plain' },
            signal,
          ));
        this.#textCache.set(document.document_number, fullText);
        if (this.#textCache.size > 100) {
          const oldest = this.#textCache.keys().next().value;
          if (oldest) this.#textCache.delete(oldest);
        }
        successfulDocuments += 1;
      } catch (error) {
        if (signal?.aborted) throw error;
        firstError ??= error;
        this.onDocumentError?.(document.document_number, error);
        continue;
      }
      if (!companyMention(fullText, companyName)) continue;
      const publishedAt = parseDate(document.publication_date);
      const agencyNames = document.agencies.map((agency) => agency.name);
      const agencySlugs = document.agencies.map((agency) => agency.slug);
      const isPatentProceeding =
        agencySlugs.includes('international-trade-commission') &&
        /\b(?:section 337|patent infringement)\b/i.test(fullText);
      items.push({
        id: `${this.id}:${document.document_number}`,
        source: this.id,
        externalId: document.document_number,
        title: document.title,
        url: document.html_url,
        ...(publishedAt ? { publishedAt, eventAt: publishedAt } : {}),
        content: [
          document.abstract ? stripHtml(document.abstract) : '',
          relevantExcerpt(fullText, companyName),
        ]
          .filter(Boolean)
          .join('\n'),
        sourceType: 'REGULATORY',
        primarySource: true,
        category: isPatentProceeding ? 'PATENT' : 'REGULATORY_ACTION',
        normalizedFacts: {
          documentNumber: document.document_number,
          documentType: document.type,
          agencies: agencyNames,
          publicationDate: document.publication_date,
        },
        entities: [symbol, companyName],
        reliability: 0.98,
        metadata: {
          symbol,
          provider: 'Federal Register',
          agencies: agencySlugs,
        },
      });
    }
    if (candidates.length > 0 && successfulDocuments === 0 && firstError) {
      throw firstError instanceof Error
        ? firstError
        : new Error('Federal Register document fetch failed', {
            cause: firstError,
          });
    }
    return items;
  }
}
