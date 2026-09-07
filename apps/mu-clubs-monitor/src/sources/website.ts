import { createHash } from 'node:crypto';
import { extractHtmlLinks, fetchPublicHtml } from '@watcher/sources/web';
import type {
  CandidateActivity,
  ClubSourceDefinition,
  MonitorSource,
} from '../types.js';

const relevant =
  /akce|ud[aá]lost|event|registr|přihl|prihl|n[aá]bor|workshop|školen|skolen|předn[aá]šk|predn[aá]šk|konferenc|sch[uů]zk|setk[aá]n|deadline|dobrovol|v[yý]let|exkur|turnaj|meetup|sraz/iu;

export class WebsiteActivitySource implements MonitorSource {
  public readonly id = 'WEBSITE';
  public constructor(private readonly fetcher: typeof fetch = fetch) {}

  public async fetch(
    source: ClubSourceDefinition,
    signal?: AbortSignal,
  ): Promise<CandidateActivity[]> {
    if (!source.url) throw new Error('Website source is missing its URL');
    if (source.url.includes('muni.cz/portal-pro-studujici/')) {
      throw new Error(
        'Static MUNI profiles are discovery-only and cannot be monitored',
      );
    }
    const { html, url: finalUrl } = await fetchPublicHtml(source.url, {
      fetcher: this.fetcher,
      ...(signal ? { signal } : {}),
      userAgent: 'Watcher/1.0 (+mu-clubs-monitor)',
    });
    const entries = extractHtmlLinks(html, finalUrl).flatMap(
      (link): CandidateActivity[] => {
        const title = link.text;
        if (title.length < 8 || !relevant.test(title)) return [];
        const externalItemId =
          link.url === finalUrl
            ? createHash('sha256').update(title).digest('hex')
            : link.url;
        return [
          {
            sourceId: source.id,
            externalItemId,
            title,
            content: title,
            sourceUrl: link.url,
            raw: { title, href: link.url },
          },
        ];
      },
    );
    const seen = new Set<string>();
    return entries
      .filter(
        ({ externalItemId }) =>
          !seen.has(externalItemId) && Boolean(seen.add(externalItemId)),
      )
      .slice(0, 50);
  }
}
