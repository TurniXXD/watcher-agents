import { z } from 'zod';
import type { Collector, EntityRef } from './types.js';
import { fetchPublicJson, type PublicJsonOptions } from './public-json.js';

const cdxSchema = z.array(z.array(z.union([z.string(), z.number()])));
const certificatesSchema = z.array(
  z.object({
    id: z.number().int().optional(),
    issuer_name: z.string().optional(),
    common_name: z.string().optional(),
    name_value: z.string().optional(),
    entry_timestamp: z.string().optional(),
    not_before: z.string().optional(),
    not_after: z.string().optional(),
    serial_number: z.string().optional(),
  }),
);

const timestampDate = (value: string): Date | undefined =>
  /^\d{14}$/u.test(value)
    ? new Date(
        `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}Z`,
      )
    : undefined;

const domainEntity = (domain: string): EntityRef => ({
  kind: 'DOMAIN',
  key: `domain:${domain}`,
  label: domain,
});

export const createWaybackCollector = (
  options: PublicJsonOptions = {},
): Collector => ({
  id: 'WAYBACK_CDX',
  supports: ['DOMAIN'],
  priority: 25,
  collect: async (selector, signal) => {
    const url = new URL('https://web.archive.org/cdx/search/cdx');
    url.searchParams.set('url', selector.value);
    url.searchParams.set('output', 'json');
    url.searchParams.set('filter', 'statuscode:200');
    url.searchParams.append('filter', 'mimetype:text/html');
    url.searchParams.set('collapse', 'digest');
    url.searchParams.set('limit', '10');
    url.searchParams.set('fl', 'timestamp,original,statuscode,digest');
    const response = await fetchPublicJson(url.toString(), cdxSchema, {
      ...options,
      signal,
    });
    const [header, ...rows] = response.data;
    if (!header) return [];
    const columns = header.map(String);
    const at = (row: (string | number)[], name: string) =>
      String(row[columns.indexOf(name)] ?? '');
    const entity = domainEntity(selector.value);
    return rows.slice(0, 10).flatMap((row) => {
      const timestamp = at(row, 'timestamp');
      const original = at(row, 'original');
      if (!timestamp || !original) return [];
      const observedAt = timestampDate(timestamp);
      return [
        {
          sourceKey: `wayback:${selector.value}:${timestamp}:${at(row, 'digest')}`,
          sourceUrl: `https://web.archive.org/web/${timestamp}/${original}`,
          excerpt: `Archivní snapshot ${selector.value} · ${timestamp} · ${original}`,
          data: {
            domain: selector.value,
            timestamp,
            originalUrl: original,
            statusCode: at(row, 'statuscode'),
            digest: at(row, 'digest'),
          },
          ...(observedAt ? { observedAt } : {}),
          findings: [
            {
              entity,
              predicate: 'ARCHIVED_SNAPSHOT',
              value: original,
              ...(observedAt ? { observedAt } : {}),
            },
          ],
          links: [],
        },
      ];
    });
  },
});

export const createCertificateTransparencyCollector = (
  options: PublicJsonOptions = {},
): Collector => ({
  id: 'CERTIFICATE_TRANSPARENCY',
  supports: ['DOMAIN'],
  priority: 30,
  collect: async (selector, signal) => {
    const url = new URL('https://crt.sh/');
    url.searchParams.set('q', `%.${selector.value}`);
    url.searchParams.set('output', 'json');
    const response = await fetchPublicJson(url.toString(), certificatesSchema, {
      ...options,
      signal,
      maximumBytes: 4_000_000,
    });
    const entity = domainEntity(selector.value);
    const seen = new Set<string>();
    return response.data.flatMap((certificate) => {
      const key = String(
        certificate.id ??
          `${certificate.serial_number}:${certificate.common_name}:${certificate.not_before}`,
      );
      if (seen.has(key) || seen.size >= 15) return [];
      seen.add(key);
      const observedAt = certificate.entry_timestamp
        ? new Date(certificate.entry_timestamp)
        : undefined;
      const names = (certificate.name_value ?? certificate.common_name ?? '')
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 20)
        .join(', ');
      return [
        {
          sourceKey: `crtsh:${selector.value}:${key}`,
          sourceUrl: `https://crt.sh/?id=${certificate.id ?? ''}`,
          excerpt:
            `Certificate Transparency ${selector.value} · ${names || 'jméno neuvedeno'} · vydavatel ${certificate.issuer_name ?? 'neuveden'} · platnost ${certificate.not_before ?? '?'} až ${certificate.not_after ?? '?'}`.slice(
              0,
              900,
            ),
          data: {
            domain: selector.value,
            certificateId: certificate.id ?? null,
            names: names || null,
            issuer: certificate.issuer_name ?? null,
            serialNumber: certificate.serial_number ?? null,
            loggedAt: certificate.entry_timestamp ?? null,
            validFrom: certificate.not_before ?? null,
            validTo: certificate.not_after ?? null,
          },
          ...(observedAt && !Number.isNaN(observedAt.getTime())
            ? { observedAt }
            : {}),
          findings: names
            ? [
                {
                  entity,
                  predicate: 'CERTIFICATE_NAMES',
                  value: names,
                },
              ]
            : [],
          links: [],
        },
      ];
    });
  },
});
