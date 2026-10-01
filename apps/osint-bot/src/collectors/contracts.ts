import { fetchPublicHtml } from '@watcher/sources';
import type { assertPublicHttpUrlResolved } from '@watcher/core';
import type { Collector, EntityRef, EvidenceDocument } from './types.js';

const base = 'https://smlouvy.gov.cz';

const text = (html: string): string =>
  html
    .replace(/<[^>]+>/gu, ' ')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#039;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replace(/\s+/gu, ' ')
    .trim();

const date = (value: string): Date | undefined => {
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/u);
  return match?.[1] && match[2] && match[3]
    ? new Date(`${match[3]}-${match[2]}-${match[1]}T00:00:00Z`)
    : undefined;
};

type ContractRow = {
  id: string;
  url: string;
  publisher: string;
  subject: string;
  latestVersion: string;
  publishedAt: string;
  value: string;
  parties: string;
};

export const parseContractSearch = (html: string): ContractRow[] => {
  const body = html.match(
    /<tbody\s+class=["']list["'][^>]*>([\s\S]*?)<\/tbody>/iu,
  )?.[1];
  if (!body) return [];
  return [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/giu)].flatMap(
    (row): ContractRow[] => {
      const rowHtml = row[1];
      if (!rowHtml) return [];
      const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/giu)].map(
        (cell) => text(cell[1] ?? ''),
      );
      const href = rowHtml.match(
        /href=["'](\/smlouva\/(\d+)(?:\?[^"']*)?)["']/iu,
      );
      if (!href?.[1] || !href[2] || cells.length < 6) return [];
      return [
        {
          id: href[2],
          url: new URL(href[1], base).toString(),
          publisher: cells[0] ?? '',
          subject: cells[1] ?? '',
          latestVersion: cells[2] ?? '',
          publishedAt: cells[3] ?? '',
          value: cells[4] ?? '',
          parties: cells[5] ?? '',
        },
      ];
    },
  );
};

const queryEntity = (type: string, value: string): EntityRef =>
  type === 'ICO'
    ? { kind: 'ORGANIZATION', key: `ico:${value}`, label: `IČO ${value}` }
    : type === 'FULL_NAME'
      ? {
          kind: 'PERSON',
          key: `contract-search-person:${value.toLocaleLowerCase('cs')}`,
          label: value,
        }
      : {
          kind: 'ORGANIZATION',
          key: `contract-search-organization:${value.toLocaleLowerCase('cs')}`,
          label: value,
        };

export const createContractRegistryCollector = (
  fetcher: typeof fetch = fetch,
  resolvePublicUrl?: typeof assertPublicHttpUrlResolved,
): Collector => ({
  id: 'CZECH_CONTRACT_REGISTRY',
  supports: ['ICO', 'COMPANY_NAME', 'FULL_NAME'],
  priority: 70,
  collect: async (selector, signal) => {
    const fields =
      selector.type === 'ICO'
        ? ['subject_idnum', 'party_idnum']
        : ['subject_name', 'party_name'];
    const results = await Promise.allSettled(
      fields.map(async (field) => {
        const url = new URL('/vyhledavani', base);
        url.searchParams.set(field, selector.value);
        const response = await fetchPublicHtml(url.toString(), {
          fetcher,
          signal,
          maximumBytes: 1_000_000,
          timeoutMs: 20_000,
          userAgent: 'Watcher OSINT/1.0 (public research)',
          ...(resolvePublicUrl ? { resolvePublicUrl } : {}),
        });
        return parseContractSearch(response.html).map((row) => ({
          row,
          field,
        }));
      }),
    );
    const entity = queryEntity(selector.type, selector.value);
    const documents = new Map<string, EvidenceDocument>();
    const successful = results.filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        { row: ContractRow; field: string }[]
      > => result.status === 'fulfilled',
    );
    if (successful.length === 0) {
      const firstFailure = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      throw firstFailure?.reason ?? new Error('Registr smluv search failed');
    }
    for (const result of successful) {
      for (const { row, field } of result.value) {
        if (documents.has(row.id)) continue;
        const observedAt = date(row.publishedAt);
        documents.set(row.id, {
          sourceKey: `registr-smluv:${row.id}`,
          sourceUrl: row.url,
          excerpt:
            `${row.publisher} · ${row.subject} · publikováno ${row.publishedAt || 'datum neuvedeno'} · ${row.value || 'hodnota neuvedena'} · smluvní strany: ${row.parties}. Výsledek vyhledávání sám nepotvrzuje totožnost stejnojmenné osoby.`.slice(
              0,
              900,
            ),
          data: {
            contractId: row.id,
            query: selector.value,
            matchedField: field,
            publisher: row.publisher,
            subject: row.subject,
            latestVersion: row.latestVersion,
            publishedAt: row.publishedAt,
            value: row.value,
            parties: row.parties,
          },
          ...(observedAt ? { observedAt } : {}),
          findings: [
            {
              entity,
              predicate: 'PUBLIC_CONTRACT_SEARCH_HIT',
              value: `${row.id}: ${row.subject}`,
              ...(observedAt ? { observedAt } : {}),
            },
          ],
          links: [],
        });
        if (documents.size >= 10) break;
      }
      if (documents.size >= 10) break;
    }
    return [...documents.values()];
  },
});
