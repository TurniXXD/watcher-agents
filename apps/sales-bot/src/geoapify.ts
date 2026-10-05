import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { BusinessSearchResult } from './discovery-types.js';

const geoapifyGeocodeSchema = z.object({
  results: z.array(
    z.object({
      place_id: z.string().min(1),
      lat: z.number(),
      lon: z.number(),
    }),
  ),
});

const rawPropertiesSchema = z.record(z.string(), z.unknown());
const geoapifyPlacesSchema = z.object({
  features: z.array(
    z.object({
      properties: z
        .object({
          place_id: z.string().min(1),
          name: z.string().min(1).optional(),
          formatted: z.string().optional(),
          lat: z.number(),
          lon: z.number(),
          datasource: z
            .object({ raw: rawPropertiesSchema.optional() })
            .optional(),
        })
        .passthrough(),
    }),
  ),
});

const geoapifyDetailsSchema = z.object({
  features: z.array(
    z.object({
      properties: z
        .object({
          feature_type: z.string().optional(),
          website: z.string().optional(),
          name: z.string().optional(),
          formatted: z.string().optional(),
          contact: z
            .object({
              phone: z.string().optional(),
              email: z.string().optional(),
            })
            .optional(),
        })
        .passthrough(),
    }),
  ),
});

type CategoryRule = {
  aliases: string[];
  geoapifyCategory: string;
  naceCode?: string;
};

const categoryRules: CategoryRule[] = [
  {
    aliases: [
      'autoservis',
      'autoservisy',
      'oprava aut',
      'opravy aut',
      'opravy motorovych vozidel',
      'pneuservis',
      'car repair',
    ],
    geoapifyCategory: 'service.vehicle.repair.car',
    naceCode: '95310',
  },
  {
    aliases: ['kadernictvi', 'holicstvi', 'barber', 'hairdresser'],
    geoapifyCategory: 'service.beauty.hairdresser',
  },
  {
    aliases: ['restaurace', 'restaurant'],
    geoapifyCategory: 'catering.restaurant',
  },
  {
    aliases: ['kavarna', 'cafe', 'coffee shop'],
    geoapifyCategory: 'catering.cafe',
  },
  {
    aliases: ['realitni kancelar', 'reality', 'estate agent'],
    geoapifyCategory: 'service.estate_agent',
  },
  {
    aliases: ['elektrikar', 'electrician'],
    geoapifyCategory: 'service.electrician',
  },
  {
    aliases: ['truhlar', 'tesar', 'carpenter'],
    geoapifyCategory: 'service.carpenter',
  },
  {
    aliases: ['uklid', 'uklidova firma', 'cleaning'],
    geoapifyCategory: 'service.cleaning',
  },
  {
    aliases: ['cestovni kancelar', 'travel agency'],
    geoapifyCategory: 'service.travel_agency',
  },
  {
    aliases: ['hotel', 'hotely'],
    geoapifyCategory: 'accommodation.hotel',
  },
  {
    aliases: ['supermarket', 'potraviny'],
    geoapifyCategory: 'commercial.supermarket',
  },
];

const normalizeQuery = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();

export type ResolvedBusinessCategory = {
  geoapifyCategory?: string;
  naceCode?: string;
};

export const resolveBusinessCategory = (
  query: string,
): ResolvedBusinessCategory => {
  const normalized = normalizeQuery(query);
  const explicitNace = /^nace\s*:\s*(\d{1,5})$/u.exec(normalized)?.[1];
  if (explicitNace) {
    return {
      naceCode: explicitNace,
      ...(explicitNace === '95310'
        ? { geoapifyCategory: 'service.vehicle.repair.car' }
        : {}),
    };
  }
  const explicitGeoapify = /^geo\s*:\s*([a-z0-9._-]+)$/u.exec(normalized)?.[1];
  if (explicitGeoapify) return { geoapifyCategory: explicitGeoapify };
  const rule = categoryRules.find((candidate) =>
    candidate.aliases.some(
      (alias) => normalized === alias || normalized.includes(alias),
    ),
  );
  return rule
    ? {
        geoapifyCategory: rule.geoapifyCategory,
        ...(rule.naceCode ? { naceCode: rule.naceCode } : {}),
      }
    : {};
};

const stringProperty = (
  raw: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined => {
  for (const key of keys) {
    const value = raw?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
};

const httpUrl = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
};

const osmSourceUrl = (
  raw: Record<string, unknown> | undefined,
  lat: number,
  lon: number,
): string => {
  const id = raw?.['osm_id'];
  const type = raw?.['osm_type'];
  const typeName =
    type === 'n' || type === 'node'
      ? 'node'
      : type === 'w' || type === 'way'
        ? 'way'
        : type === 'r' || type === 'relation'
          ? 'relation'
          : undefined;
  return typeName && (typeof id === 'string' || typeof id === 'number')
    ? `https://www.openstreetmap.org/${typeName}/${encodeURIComponent(String(id))}`
    : `https://www.openstreetmap.org/?mlat=${encodeURIComponent(String(lat))}&mlon=${encodeURIComponent(String(lon))}#map=18/${encodeURIComponent(String(lat))}/${encodeURIComponent(String(lon))}`;
};

export class GeoapifyDiscoveryClient {
  public constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly detailDelayMs = 220,
  ) {}

  public async search(
    query: string,
    locality: string,
    requestedLimit: number,
  ): Promise<BusinessSearchResult[]> {
    const input = z
      .object({
        query: z.string().trim().min(1).max(120),
        locality: z.string().trim().min(1).max(120),
        limit: z.number().int().min(1).max(20),
      })
      .parse({ query, locality, limit: requestedLimit });
    const category = resolveBusinessCategory(input.query);
    if (!category.geoapifyCategory) return [];

    const geocodeUrl = new URL('https://api.geoapify.com/v1/geocode/search');
    geocodeUrl.searchParams.set('text', input.locality);
    geocodeUrl.searchParams.set('filter', 'countrycode:cz');
    geocodeUrl.searchParams.set('lang', 'cs');
    geocodeUrl.searchParams.set('limit', '1');
    geocodeUrl.searchParams.set('format', 'json');
    geocodeUrl.searchParams.set('apiKey', this.apiKey);
    const geocodeResponse = await this.fetcher(geocodeUrl, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!geocodeResponse.ok)
      throw new Error(`Geoapify geocoding HTTP ${geocodeResponse.status}`);
    const location = geoapifyGeocodeSchema.parse(await geocodeResponse.json())
      .results[0];
    if (!location) return [];

    const placesUrl = new URL('https://api.geoapify.com/v2/places');
    placesUrl.searchParams.set('categories', category.geoapifyCategory);
    placesUrl.searchParams.set('filter', `place:${location.place_id}`);
    placesUrl.searchParams.set(
      'bias',
      `proximity:${location.lon},${location.lat}`,
    );
    placesUrl.searchParams.set('lang', 'cs');
    placesUrl.searchParams.set('limit', String(input.limit));
    placesUrl.searchParams.set('apiKey', this.apiKey);
    const placesResponse = await this.fetcher(placesUrl, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!placesResponse.ok)
      throw new Error(`Geoapify Places HTTP ${placesResponse.status}`);
    const places = geoapifyPlacesSchema.parse(
      await placesResponse.json(),
    ).features;

    const results: BusinessSearchResult[] = [];
    for (const [index, feature] of places.entries()) {
      const place = feature.properties;
      if (!place.name) continue;
      const raw = place.datasource?.raw;
      let website = httpUrl(
        stringProperty(raw, ['website', 'contact:website', 'url']),
      );
      let phone = stringProperty(raw, ['phone', 'contact:phone']);
      let email = stringProperty(raw, ['email', 'contact:email']);
      if (!website || !phone) {
        if (index > 0 && this.detailDelayMs > 0)
          await delay(this.detailDelayMs);
        const details = await this.details(place.place_id);
        website ??= httpUrl(details?.website);
        phone ??= details?.phone;
        email ??= details?.email;
      }
      results.push({
        id: place.place_id,
        name: place.name,
        provider: 'GEOAPIFY',
        sourceUrl: osmSourceUrl(raw, place.lat, place.lon),
        ...(website ? { websiteUrl: website } : {}),
        ...(place.formatted ? { address: place.formatted } : {}),
        ...(phone ? { phone } : {}),
        ...(email ? { email } : {}),
      });
    }
    return results.slice(0, input.limit);
  }

  private async details(placeId: string): Promise<
    | {
        website?: string;
        phone?: string;
        email?: string;
      }
    | undefined
  > {
    try {
      const url = new URL('https://api.geoapify.com/v2/place-details');
      url.searchParams.set('id', placeId);
      url.searchParams.set('features', 'details');
      url.searchParams.set('lang', 'cs');
      url.searchParams.set('apiKey', this.apiKey);
      const response = await this.fetcher(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return undefined;
      const parsed = geoapifyDetailsSchema.parse(await response.json());
      const details = parsed.features.find(
        (feature) => feature.properties.feature_type === 'details',
      )?.properties;
      if (!details) return undefined;
      return {
        ...(details.website ? { website: details.website } : {}),
        ...(details.contact?.phone ? { phone: details.contact.phone } : {}),
        ...(details.contact?.email ? { email: details.contact.email } : {}),
      };
    } catch {
      return undefined;
    }
  }
}
