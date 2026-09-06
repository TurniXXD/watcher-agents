import type { Source, WatchItem } from '@watcher/core';
import { z } from 'zod';
import { fetchJson } from './utils/http.js';

const responseSchema = z.object({
  collection: z.array(
    z.object({
      doi: z.string(),
      title: z.string(),
      abstract: z.string(),
      date: z.string(),
      authors: z.string(),
      category: z.string(),
    }),
  ),
});

type BioRxivPayload = z.infer<typeof responseSchema>;
type CachedPayload = {
  url: string;
  expiresAt: number;
  promise: Promise<BioRxivPayload>;
};

const CACHE_TTL_MS = 30 * 60_000;
const FAILURE_CACHE_TTL_MS = 5 * 60_000;

export class BioRxivSource implements Source<{
  query: string;
  maxItems?: number;
}> {
  public readonly id = 'BIORXIV';
  public readonly capabilities = {
    sourceName: 'bioRxiv',
    sourceType: 'PUBLICATION' as const,
    minimumIntervalMs: 60_000,
    preferredIntervalMs: 6 * 60 * 60_000,
    maximumIntervalMs: 24 * 60 * 60_000,
    supportsStreaming: false,
    costPerRequestUsd: 0,
    rateLimitPerMinute: null,
    priority: 80,
    requestPolicy: {
      maxConcurrency: 1,
      minimumSpacingMs: 0,
      sharedRateLimitBackoff: true,
    },
  };
  private cachedPayload?: CachedPayload;
  public constructor(private readonly fetcher: typeof fetch = fetch) {}

  private payload(url: string, signal?: AbortSignal): Promise<BioRxivPayload> {
    const now = Date.now();
    if (this.cachedPayload?.url === url && this.cachedPayload.expiresAt > now) {
      return this.cachedPayload.promise;
    }
    const promise = fetchJson(this.fetcher, url, signal).then((value) =>
      responseSchema.parse(value),
    );
    this.cachedPayload = {
      url,
      expiresAt: now + CACHE_TTL_MS,
      promise,
    };
    void promise.catch(() => {
      if (this.cachedPayload?.promise === promise) {
        this.cachedPayload.expiresAt = Date.now() + FAILURE_CACHE_TTL_MS;
      }
    });
    return promise;
  }

  public async fetch(
    config: { query: string; maxItems?: number },
    signal?: AbortSignal,
  ): Promise<WatchItem[]> {
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 86_400_000);
    const date = (value: Date) => value.toISOString().slice(0, 10);
    const payload = await this.payload(
      `https://api.biorxiv.org/details/biorxiv/${date(start)}/${date(end)}/0`,
      signal,
    );
    const terms = config.query.toLowerCase().split(/\s+/).filter(Boolean);
    return payload.collection
      .filter((entry) => {
        const haystack = `${entry.title} ${entry.abstract}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      })
      .slice(0, config.maxItems ?? 10)
      .map((entry) => ({
        id: `BIORXIV:${entry.doi}`,
        source: this.id,
        externalId: entry.doi,
        title: entry.title,
        url: `https://www.biorxiv.org/content/${entry.doi}`,
        publishedAt: new Date(`${entry.date}T00:00:00Z`),
        content: entry.abstract,
        sourceType: 'PUBLICATION' as const,
        primarySource: true,
        eventAt: new Date(`${entry.date}T00:00:00Z`),
        category: 'PUBLICATION',
        normalizedFacts: { doi: entry.doi, category: entry.category },
        entities: [],
        reliability: 0.85,
        metadata: {
          query: config.query,
          authors: entry.authors,
          category: entry.category,
        },
      }));
  }
}
