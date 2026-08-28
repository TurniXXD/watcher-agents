import type { Source, WatchItem } from '@watcher/core';
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { fetchJson, fetchText } from './http.js';

const searchSchema = z.object({
  esearchresult: z.object({ idlist: z.array(z.string()) }),
});
type PubmedArticle = Record<string, unknown>;
const text = (value: unknown): string => {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(' ');
  if (typeof value === 'string' || typeof value === 'number')
    return String(value);
  if (value && typeof value === 'object')
    return text((value as Record<string, unknown>)['#text']);
  return '';
};

export class PubMedSource implements Source<{
  query: string;
  maxItems?: number;
}> {
  public readonly id = 'PUBMED';
  public constructor(private readonly fetcher: typeof fetch = fetch) {}

  public async fetch(
    config: { query: string; maxItems?: number },
    signal?: AbortSignal,
  ): Promise<WatchItem[]> {
    const params = new URLSearchParams({
      db: 'pubmed',
      term: config.query,
      retmode: 'json',
      retmax: String(Math.min(config.maxItems ?? 10, 20)),
      sort: 'pub date',
      tool: 'watcher',
    });
    const search = searchSchema.parse(
      await fetchJson(
        this.fetcher,
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${params}`,
        signal,
      ),
    );
    if (search.esearchresult.idlist.length === 0) return [];
    const fetchParams = new URLSearchParams({
      db: 'pubmed',
      id: search.esearchresult.idlist.join(','),
      retmode: 'xml',
      tool: 'watcher',
    });
    const xml = await fetchText(
      this.fetcher,
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?${fetchParams}`,
      signal,
    );
    const parsed = new XMLParser({ ignoreAttributes: false }).parse(xml) as {
      PubmedArticleSet?: { PubmedArticle?: PubmedArticle | PubmedArticle[] };
    };
    const raw = parsed.PubmedArticleSet?.PubmedArticle ?? [];
    const articles = Array.isArray(raw) ? raw : [raw];
    return articles.flatMap((record) => {
      const citation = record.MedlineCitation as
        Record<string, unknown> | undefined;
      const article = citation?.Article as Record<string, unknown> | undefined;
      const pmid = text(citation?.PMID);
      const title = text(article?.ArticleTitle);
      const abstract = text(
        (article?.Abstract as Record<string, unknown> | undefined)
          ?.AbstractText,
      );
      if (!pmid || !title || !abstract) return [];
      return [
        {
          id: `PUBMED:${pmid}`,
          source: this.id,
          externalId: pmid,
          title,
          url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
          content: abstract,
          metadata: {
            query: config.query,
            journal: text(article?.Journal),
            authors: text(article?.AuthorList),
          },
        },
      ];
    });
  }
}
