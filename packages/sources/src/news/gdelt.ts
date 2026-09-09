import { createHash } from 'node:crypto';
import {
  parseDate,
  sourceHttpError,
  type Source,
  type WatchItem,
} from '@watcher/core';
import { z } from 'zod';
import type { NewsScope } from './catalog.js';

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

export type GdeltNewsConfig = {
  query: string;
  sourceId?: string;
  sourceName?: string;
  scope?: NewsScope;
  topics?: string[];
  entities?: string[];
  publishers?: Record<string, { sourceKey: string; sourceName: string }>;
  metadata?: Record<string, unknown>;
  reliability?: number;
  maxItems?: number;
};

export class GdeltNewsSource implements Source<GdeltNewsConfig> {
  public readonly id = 'NEWS_GDELT';
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
      providerKey: 'GDELT_DOC_2',
      maxConcurrency: 1,
      minimumSpacingMs: 5_000,
      sharedRateLimitBackoff: true,
    },
  } as const;

  public constructor(private readonly fetcher: typeof fetch = fetch) {}

  public async fetch(
    config: GdeltNewsConfig,
    signal?: AbortSignal,
  ): Promise<WatchItem[]> {
    const query = config.query.trim();
    if (!query) throw new Error('GDELT query must not be empty');
    const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
    url.searchParams.set('query', query);
    url.searchParams.set('mode', 'artlist');
    url.searchParams.set('format', 'json');
    url.searchParams.set('sort', 'datedesc');
    url.searchParams.set('timespan', '1d');
    url.searchParams.set(
      'maxrecords',
      String(Math.min(Math.max(config.maxItems ?? 10, 1), 25)),
    );
    const response = await this.fetcher(url, {
      headers: { accept: 'application/json', 'user-agent': 'Watcher/1.0' },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw sourceHttpError(response, url);
    const responseText = await response.text();
    if (
      /requests more sparingly|rate[_ -]?limit|limit requests|too many requests/iu.test(
        responseText,
      )
    ) {
      throw new Error(
        `GDELT rate limit: ${responseText.replaceAll(/\s+/gu, ' ').trim().slice(0, 500)}`,
      );
    }
    const parsed = responseSchema.parse(JSON.parse(responseText));
    const source =
      config.sourceId ??
      (config.scope ? `NEWS_GDELT_${config.scope}` : this.id);
    return parsed.articles.map((article) => {
      const externalId = createHash('sha256').update(article.url).digest('hex');
      const publishedAt = parseDate(article.seendate);
      const publisherDomain = article.domain
        ?.toLocaleLowerCase('en-US')
        .replace(/^www\./u, '');
      const publisher = publisherDomain
        ? config.publishers?.[publisherDomain]
        : undefined;
      return {
        id: `${source}:${externalId}`,
        source,
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
        entities: config.entities ?? [],
        reliability: config.reliability ?? 0.6,
        metadata: {
          ...config.metadata,
          ...(config.scope ? { scope: config.scope } : {}),
          ...(config.topics ? { topics: config.topics } : {}),
          ...(publisher?.sourceKey ? { sourceKey: publisher.sourceKey } : {}),
          ...(publisher?.sourceName || config.sourceName
            ? { feedName: publisher?.sourceName ?? config.sourceName }
            : {}),
          publisherDomain: article.domain,
        },
      };
    });
  }
}
