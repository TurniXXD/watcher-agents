import { resolve4, resolve6, resolveMx, resolveNs } from 'node:dns/promises';
import { fetchPublicHtml } from '@watcher/sources';
import type { assertPublicHttpUrlResolved } from '@watcher/core';
import type { Collector, EntityRef } from './types.js';

const textContent = (value: string): string =>
  value
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 500);

export const createWebsiteCollector = (
  fetcher: typeof fetch = fetch,
  resolvePublicUrl?: typeof assertPublicHttpUrlResolved,
): Collector => ({
  id: 'WEBSITE',
  supports: ['DOMAIN'],
  priority: 60,
  collect: async (selector, signal) => {
    const result = await fetchPublicHtml(`https://${selector.value}/`, {
      fetcher,
      signal,
      timeoutMs: 12_000,
      maximumBytes: 250_000,
      ...(resolvePublicUrl ? { resolvePublicUrl } : {}),
    });
    const title = textContent(
      result.html.match(/<title[^>]*>([\s\S]*?)<\/title>/iu)?.[1] ?? '',
    );
    const description = textContent(
      result.html.match(
        /<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/iu,
      )?.[1] ?? '',
    );
    const domain: EntityRef = {
      kind: 'DOMAIN',
      key: `domain:${selector.value}`,
      label: selector.value,
    };
    return [
      {
        sourceKey: `website:${selector.value}`,
        sourceUrl: result.url,
        excerpt: [title || selector.value, description]
          .filter(Boolean)
          .join(' · ')
          .slice(0, 900),
        data: {
          domain: selector.value,
          title: title || null,
          description: description || null,
        },
        findings: [
          ...(title
            ? [{ entity: domain, predicate: 'WEBSITE_TITLE', value: title }]
            : []),
          ...(description
            ? [
                {
                  entity: domain,
                  predicate: 'WEBSITE_DESCRIPTION',
                  value: description,
                },
              ]
            : []),
        ],
        links: [],
      },
    ];
  },
});

type DnsLookup = {
  resolve4: typeof resolve4;
  resolve6: typeof resolve6;
  resolveMx: typeof resolveMx;
  resolveNs: typeof resolveNs;
};
export const createDnsCollector = (
  lookup: DnsLookup = { resolve4, resolve6, resolveMx, resolveNs },
): Collector => ({
  id: 'DNS',
  supports: ['DOMAIN'],
  priority: 50,
  collect: async (selector) => {
    const queries = await Promise.race([
      Promise.allSettled([
        lookup.resolve4(selector.value),
        lookup.resolve6(selector.value),
        lookup.resolveMx(selector.value),
        lookup.resolveNs(selector.value),
      ]),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('DNS lookup timed out')), 8_000),
      ),
    ]);
    const labels = ['A', 'AAAA', 'MX', 'NS'] as const;
    const rows = queries.flatMap((query, index) =>
      query.status === 'fulfilled'
        ? (query.value as (string | { exchange: string; priority: number })[])
            .slice(0, 20)
            .map((answer) => ({
              type: labels[index] ?? 'DNS',
              value:
                typeof answer === 'string'
                  ? answer
                  : `${answer.priority} ${answer.exchange}`,
            }))
        : [],
    );
    if (rows.length === 0) throw new Error('No public DNS answers returned');
    const domain: EntityRef = {
      kind: 'DOMAIN',
      key: `domain:${selector.value}`,
      label: selector.value,
    };
    return [
      {
        sourceKey: `dns:${selector.value}`,
        sourceUrl: `https://${selector.value}/`,
        excerpt: rows
          .map((row) => `${row.type} ${row.value}`)
          .join(' · ')
          .slice(0, 900),
        data: {
          domain: selector.value,
          answers: rows.map((row) => `${row.type} ${row.value}`).join('\n'),
        },
        findings: rows.map((row) => ({
          entity: domain,
          predicate: `DNS_${row.type}`,
          value: row.value,
        })),
        links: [],
      },
    ];
  },
});
