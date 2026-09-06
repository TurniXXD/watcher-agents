import { createHash } from 'node:crypto';
import { parseDate, type Source, type WatchItem } from '@watcher/core';
import { z } from 'zod';
import { fetchText } from './utils/http.js';

const responseSchema = z.object({
  articles: z
    .array(
      z.object({
        url: z.url(),
        title: z.string().min(1),
        seendate: z.string().optional(),
        domain: z.string().optional(),
        language: z.string().optional(),
        sourcecountry: z.string().optional(),
      }),
    )
    .default([]),
});

export type NewsConfig = {
  symbol: string;
  companyName?: string | null;
  maxItems?: number;
};

export class GdeltNewsSource implements Source<NewsConfig> {
  public readonly id = 'NEWS';
  public readonly capabilities = {
    sourceName: 'GDELT DOC 2.0',
    sourceType: 'NEWS' as const,
    minimumIntervalMs: 60_000,
    preferredIntervalMs: 5 * 60_000,
    maximumIntervalMs: 30 * 60_000,
    supportsStreaming: false,
    costPerRequestUsd: 0,
    rateLimitPerMinute: null,
    priority: 75,
    requestPolicy: {
      maxConcurrency: 1,
      minimumSpacingMs: 5_000,
      sharedRateLimitBackoff: true,
    },
  };

  public constructor(private readonly fetcher: typeof fetch = fetch) {}

  public async fetch(
    config: NewsConfig,
    signal?: AbortSignal,
  ): Promise<WatchItem[]> {
    const symbol = config.symbol.trim().toUpperCase();
    const query = config.companyName?.trim()
      ? `"${config.companyName.trim().replaceAll('"', '')}"`
      : `${symbol} stock`;
    const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
    url.searchParams.set('query', `${query} sourcelang:english`);
    url.searchParams.set('mode', 'artlist');
    url.searchParams.set('format', 'json');
    url.searchParams.set('sort', 'datedesc');
    url.searchParams.set('timespan', '1d');
    url.searchParams.set(
      'maxrecords',
      String(Math.min(config.maxItems ?? 10, 25)),
    );
    const responseText = await fetchText(
      this.fetcher,
      url.toString(),
      { accept: 'application/json' },
      signal,
    );
    if (
      /requests more sparingly|rate[_ -]?limit|limit requests|too many requests/i.test(
        responseText,
      )
    ) {
      throw new Error(
        `GDELT rate limit: ${responseText.replaceAll(/\s+/g, ' ').trim().slice(0, 500)}`,
      );
    }
    const response = responseSchema.parse(JSON.parse(responseText));
    return response.articles.map((article) => {
      const externalId = createHash('sha256').update(article.url).digest('hex');
      const publishedAt = parseDate(article.seendate);
      return {
        id: `${this.id}:${externalId}`,
        source: this.id,
        externalId,
        title: article.title,
        url: article.url,
        ...(publishedAt ? { publishedAt, eventAt: publishedAt } : {}),
        content: [
          article.title,
          article.domain ? `Publisher domain: ${article.domain}` : '',
          article.seendate ? `Observed by GDELT: ${article.seendate}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        sourceType: 'NEWS' as const,
        primarySource: false,
        category: 'NEWS',
        normalizedFacts: {
          publisherDomain: article.domain,
          sourceCountry: article.sourcecountry,
          language: article.language,
        },
        entities: [symbol, ...(config.companyName ? [config.companyName] : [])],
        reliability: 0.6,
        metadata: {
          symbol,
          companyName: config.companyName,
          publisherDomain: article.domain,
        },
      };
    });
  }
}
