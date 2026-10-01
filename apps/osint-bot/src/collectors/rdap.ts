import { isIP } from 'node:net';
import { z } from 'zod';
import type { Collector, EntityRef } from './types.js';
import { fetchPublicJson, type PublicJsonOptions } from './public-json.js';

const bootstrapSchema = z.object({
  services: z.array(z.tuple([z.array(z.string()), z.array(z.string().url())])),
});
const rdapSchema = z.object({
  objectClassName: z.string().optional(),
  handle: z.string().optional(),
  ldhName: z.string().optional(),
  unicodeName: z.string().optional(),
  name: z.string().optional(),
  type: z.string().optional(),
  startAddress: z.string().optional(),
  endAddress: z.string().optional(),
  country: z.string().optional(),
  status: z.array(z.string()).optional(),
  events: z
    .array(
      z.object({
        eventAction: z.string().optional(),
        eventDate: z.string().optional(),
      }),
    )
    .optional(),
  entities: z
    .array(
      z.object({
        roles: z.array(z.string()).optional(),
        vcardArray: z.unknown().optional(),
      }),
    )
    .optional(),
});

const ipv4 = (value: string): bigint | undefined => {
  if (isIP(value) !== 4) return undefined;
  return value
    .split('.')
    .reduce((result, part) => (result << 8n) + BigInt(Number(part)), 0n);
};

const ipv6Parts = (value: string): number[] | undefined => {
  if (isIP(value) !== 6) return undefined;
  const [left = '', right = ''] = value.toLowerCase().split('::');
  const parseSide = (side: string): number[] =>
    side
      ? side.split(':').flatMap((part) => {
          if (part.includes('.')) {
            const asV4 = ipv4(part);
            return asV4 === undefined
              ? []
              : [Number((asV4 >> 16n) & 0xffffn), Number(asV4 & 0xffffn)];
          }
          return [Number.parseInt(part, 16)];
        })
      : [];
  const before = parseSide(left);
  const after = parseSide(right);
  const omitted = 8 - before.length - after.length;
  return [...before, ...Array.from({ length: omitted }, () => 0), ...after];
};

const ipValue = (
  value: string,
): { bits: number; value: bigint } | undefined => {
  const asV4 = ipv4(value);
  if (asV4 !== undefined) return { bits: 32, value: asV4 };
  const parts = ipv6Parts(value);
  if (!parts || parts.length !== 8) return undefined;
  return {
    bits: 128,
    value: parts.reduce((result, part) => (result << 16n) + BigInt(part), 0n),
  };
};

export const cidrContains = (cidr: string, address: string): boolean => {
  const [networkText, prefixText] = cidr.split('/');
  if (!networkText || !prefixText) return false;
  const network = ipValue(networkText);
  const target = ipValue(address);
  const prefix = Number(prefixText);
  if (
    !network ||
    !target ||
    network.bits !== target.bits ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > network.bits
  )
    return false;
  const shift = BigInt(network.bits - prefix);
  return network.value >> shift === target.value >> shift;
};

const bootstrapEndpoint = (type: 'DOMAIN' | 'IP_ADDRESS', value: string) =>
  type === 'DOMAIN'
    ? {
        url: 'https://data.iana.org/rdap/dns.json',
        match: (entry: string) =>
          entry.toLowerCase() === value.split('.').at(-1)?.toLowerCase(),
      }
    : {
        url:
          isIP(value) === 4
            ? 'https://data.iana.org/rdap/ipv4.json'
            : 'https://data.iana.org/rdap/ipv6.json',
        match: (entry: string) => cidrContains(entry, value),
      };

const registrarName = (value: unknown): string | undefined => {
  if (!Array.isArray(value) || !Array.isArray(value[1])) return undefined;
  for (const row of value[1]) {
    if (Array.isArray(row) && row[0] === 'fn' && typeof row[3] === 'string')
      return row[3];
  }
  return undefined;
};

export const createRdapCollector = (
  options: PublicJsonOptions = {},
): Collector => ({
  id: 'RDAP',
  supports: ['DOMAIN', 'IP_ADDRESS'],
  priority: 45,
  collect: async (selector, signal) => {
    if (selector.type !== 'DOMAIN' && selector.type !== 'IP_ADDRESS')
      throw new Error('RDAP collector received an unsupported selector');
    const bootstrap = bootstrapEndpoint(selector.type, selector.value);
    const catalog = await fetchPublicJson(bootstrap.url, bootstrapSchema, {
      ...options,
      signal,
    });
    const service = catalog.data.services.find(([entries]) =>
      entries.some(bootstrap.match),
    );
    const baseUrl = service?.[1][0];
    if (!baseUrl) return [];
    const requestUrl = new URL(
      `${selector.type === 'DOMAIN' ? 'domain' : 'ip'}/${encodeURIComponent(selector.value)}`,
      baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
    ).toString();
    const response = await fetchPublicJson(requestUrl, rdapSchema, {
      ...options,
      signal,
    });
    const entity: EntityRef =
      selector.type === 'DOMAIN'
        ? {
            kind: 'DOMAIN',
            key: `domain:${selector.value}`,
            label: selector.value,
          }
        : {
            kind: 'IP_ADDRESS',
            key: `ip:${selector.value}`,
            label: selector.value,
          };
    const registrars = (response.data.entities ?? [])
      .filter((item) => item.roles?.includes('registrar'))
      .map((item) => registrarName(item.vcardArray))
      .filter((item): item is string => Boolean(item));
    const events = (response.data.events ?? []).filter(
      (item) => item.eventAction && item.eventDate,
    );
    const datedEvents = events.flatMap((event) => {
      const observedAt = new Date(event.eventDate ?? '');
      return Number.isNaN(observedAt.getTime()) ? [] : [{ event, observedAt }];
    });
    const mostRecent = datedEvents
      .map(({ observedAt }) => observedAt)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    return [
      {
        sourceKey: `rdap:${selector.type.toLowerCase()}:${selector.value}`,
        sourceUrl: response.url,
        excerpt:
          `RDAP ${selector.value} · handle ${response.data.handle ?? 'neuveden'} · stav ${(response.data.status ?? []).join(', ') || 'neuveden'}${registrars.length ? ` · registrátor ${registrars.join(', ')}` : ''}`.slice(
            0,
            900,
          ),
        data: {
          query: selector.value,
          objectClass: response.data.objectClassName ?? null,
          handle: response.data.handle ?? null,
          name:
            response.data.ldhName ??
            response.data.unicodeName ??
            response.data.name ??
            null,
          type: response.data.type ?? null,
          startAddress: response.data.startAddress ?? null,
          endAddress: response.data.endAddress ?? null,
          country: response.data.country ?? null,
          status: (response.data.status ?? []).join(', '),
          registrar: registrars.join(', ') || null,
          events: events
            .map((event) => `${event.eventAction}: ${event.eventDate}`)
            .join('; '),
        },
        ...(mostRecent ? { observedAt: mostRecent } : {}),
        findings: [
          ...(response.data.handle
            ? [
                {
                  entity,
                  predicate: 'RDAP_HANDLE',
                  value: response.data.handle,
                },
              ]
            : []),
          ...(response.data.status ?? []).map((status) => ({
            entity,
            predicate: 'RDAP_STATUS',
            value: status,
          })),
          ...registrars.map((registrar) => ({
            entity,
            predicate: 'RDAP_REGISTRAR',
            value: registrar,
          })),
          ...datedEvents.map(({ event, observedAt }) => ({
            entity,
            predicate: `RDAP_EVENT_${event.eventAction?.toUpperCase().replaceAll(' ', '_')}`,
            value: event.eventDate ?? '',
            observedAt,
          })),
        ],
        links: [],
      },
    ];
  },
});
