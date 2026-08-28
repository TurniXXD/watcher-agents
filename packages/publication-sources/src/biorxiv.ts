import type { Source, WatchItem } from '@watcher/core';
import { z } from 'zod';
import { fetchJson } from './http.js';

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

export class BioRxivSource implements Source<{
  query: string;
  maxItems?: number;
}> {
  public readonly id = 'BIORXIV';
  public constructor(private readonly fetcher: typeof fetch = fetch) {}

  public async fetch(
    config: { query: string; maxItems?: number },
    signal?: AbortSignal,
  ): Promise<WatchItem[]> {
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 86_400_000);
    const date = (value: Date) => value.toISOString().slice(0, 10);
    const payload = responseSchema.parse(
      await fetchJson(
        this.fetcher,
        `https://api.biorxiv.org/details/biorxiv/${date(start)}/${date(end)}/0`,
        signal,
      ),
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
        metadata: {
          query: config.query,
          authors: entry.authors,
          category: entry.category,
        },
      }));
  }
}
