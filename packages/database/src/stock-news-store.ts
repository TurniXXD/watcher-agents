import { stockAnalysisSchema, type StockAnalysis } from '@watcher/core';
import { z } from 'zod';
import type { DatabaseClient } from './client.js';
import { AnalysisStatus, WatcherKind } from './generated/prisma/enums.js';
import { titleSimilarity } from './stock-domain/index.js';
import { jsonObject } from './utils/json.js';

const stockNewsQuerySchema = z
  .object({
    chatConfigId: z.string().trim().min(1),
    ticker: z
      .string()
      .trim()
      .min(1)
      .max(10)
      .transform((value) => value.toUpperCase()),
    from: z.date(),
    to: z.date(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.to < value.from) {
      context.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'News range end must not precede its start',
      });
    }
  });

export type StoredStockNewsArticle = {
  publishedAt: Date;
  tickers: string[];
  headline: string;
  summary: string;
  description: string;
  source: string;
  url: string;
  sentiment?: 'positive' | 'neutral' | 'negative';
  importance?: number;
  analysis?: StockAnalysis;
};

type StockNewsCandidate = StoredStockNewsArticle & {
  eventIds: string[];
};

const stringValue = (
  record: Record<string, unknown>,
  key: string,
): string | undefined => {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

const relatedTickers = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap((entry) => {
        if (typeof entry !== 'string') return [];
        const ticker = entry.split(':').at(-1)?.trim().toUpperCase();
        return ticker && /^[A-Z][A-Z0-9.-]{0,9}$/u.test(ticker) ? [ticker] : [];
      })
    : [];

const shortStoredSummary = (
  headline: string,
  rawText: string | null,
): string => {
  const compact = rawText?.replace(/\s+/gu, ' ').trim() ?? '';
  const withoutHeadline = compact.startsWith(headline)
    ? compact.slice(headline.length).replace(/^\s*[-:|]?\s*/u, '')
    : compact;
  if (!withoutHeadline) return 'No analysis summary is stored.';
  return withoutHeadline.length <= 500
    ? withoutHeadline
    : `${withoutHeadline.slice(0, 499).trimEnd()}…`;
};

const comparableUrl = (rawUrl: string): string => {
  const url = new URL(rawUrl);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_.+|fbclid|gclid)$/iu.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.toString().replace(/\/$/u, '');
};

const candidatesAreDuplicates = (
  left: StockNewsCandidate,
  right: StockNewsCandidate,
): boolean =>
  comparableUrl(left.url) === comparableUrl(right.url) ||
  left.eventIds.some((eventId) => right.eventIds.includes(eventId)) ||
  titleSimilarity(left.headline, right.headline) >= 0.82;

export const deduplicateStoredStockNews = (
  candidates: readonly StockNewsCandidate[],
): StoredStockNewsArticle[] => {
  const selected: StockNewsCandidate[] = [];
  const newestFirst = [...candidates].sort(
    (left, right) => right.publishedAt.getTime() - left.publishedAt.getTime(),
  );
  for (const candidate of newestFirst) {
    if (
      !selected.some((existing) => candidatesAreDuplicates(existing, candidate))
    ) {
      selected.push(candidate);
    }
  }
  return selected.map(({ eventIds, ...article }) => {
    void eventIds;
    return article;
  });
};

export class StockNewsStore {
  public constructor(private readonly db: DatabaseClient) {}

  public async list(rawInput: unknown): Promise<StoredStockNewsArticle[]> {
    const input = stockNewsQuerySchema.parse(rawInput);
    const rows = await this.db.processedItem.findMany({
      where: {
        watcherKind: WatcherKind.STOCKS,
        sourceType: 'NEWS',
        ticker: input.ticker,
        publishedAt: { gte: input.from, lte: input.to },
        OR: [
          {
            analyses: {
              some: {
                run: { watcherConfig: { chatConfigId: input.chatConfigId } },
              },
            },
          },
          {
            eventObservations: {
              some: {
                run: { watcherConfig: { chatConfigId: input.chatConfigId } },
              },
            },
          },
        ],
      },
      orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
      include: {
        analyses: {
          where: {
            status: AnalysisStatus.SUCCESS,
            run: { watcherConfig: { chatConfigId: input.chatConfigId } },
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { result: true },
        },
        eventObservations: {
          select: {
            eventId: true,
            event: { select: { ticker: true } },
          },
        },
      },
    });

    const candidates = rows.flatMap((row): StockNewsCandidate[] => {
      if (!row.publishedAt) return [];
      const facts = jsonObject(row.normalizedFacts);
      const metadata = jsonObject(row.metadata);
      const analysis = stockAnalysisSchema.safeParse(row.analyses[0]?.result);
      const headline = row.headline ?? row.title;
      const tickers = [
        ...(row.ticker ? [row.ticker] : []),
        ...row.eventObservations.map(({ event }) => event.ticker),
        ...relatedTickers(facts.relatedSymbols),
      ];
      return [
        {
          publishedAt: row.publishedAt,
          tickers: [...new Set(tickers)].sort(),
          headline,
          summary: analysis.success
            ? analysis.data.summary
            : shortStoredSummary(row.headline ?? row.title, row.rawText),
          description: row.rawText ?? row.title,
          source:
            stringValue(facts, 'provider') ??
            stringValue(metadata, 'feedName') ??
            stringValue(facts, 'publisherDomain') ??
            stringValue(metadata, 'publisherDomain') ??
            row.source,
          url: row.sourceUrl ?? row.url,
          ...(analysis.success
            ? {
                sentiment: analysis.data.sentiment,
                importance: analysis.data.importance,
                analysis: analysis.data,
              }
            : {}),
          eventIds: [
            ...new Set(row.eventObservations.map(({ eventId }) => eventId)),
          ],
        },
      ];
    });
    return deduplicateStoredStockNews(candidates);
  }
}
