import { retryTransient } from '@watcher/core';
import { z } from 'zod';
import {
  rawEventSchema,
  type EventCategory,
  type EventSource,
  type RawEvent,
} from '../domain/types.js';
import { canonicalUrl } from '../domain/normalization.js';
import { inferCategories } from '../domain/categorization.js';

const objectSchema = z.record(z.string(), z.unknown());
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;
const objects = (value: unknown): Record<string, unknown>[] => {
  if (Array.isArray(value)) return value.flatMap(objects);
  const parsed = objectSchema.safeParse(value);
  if (!parsed.success) return [];
  const nested = [parsed.data['@graph'], parsed.data.itemListElement].flatMap(
    objects,
  );
  const item = objectSchema.safeParse(parsed.data.item).success
    ? objects(parsed.data.item)
    : [];
  return [parsed.data, ...nested, ...item];
};
const address = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  const parsed = objectSchema.safeParse(value);
  if (!parsed.success) return undefined;
  return (
    [
      parsed.data.streetAddress,
      parsed.data.addressLocality,
      parsed.data.postalCode,
    ]
      .map(text)
      .filter(Boolean)
      .join(', ') || undefined
  );
};
const typeIncludesEvent = (value: unknown): boolean =>
  (Array.isArray(value) ? value : [value]).some(
    (entry) => text(entry)?.toLowerCase() === 'event',
  );

const date = (value: unknown): Date | undefined => {
  const raw = text(value);
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const supportedCurrency = (value: unknown): 'CZK' | 'EUR' | undefined => {
  const currency = text(value)?.toUpperCase();
  return currency === 'CZK' || currency === 'EUR' ? currency : undefined;
};

export const parseJsonLdEvents = (
  html: string,
  pageUrl: string,
  categories: EventCategory[] = ['other'],
): RawEvent[] => {
  const scripts = [
    ...html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu,
    ),
  ];
  return scripts.flatMap((match) => {
    try {
      return objects(JSON.parse(match[1]!))
        .filter((entry) => typeIncludesEvent(entry['@type']))
        .flatMap((entry) => {
          const location = objectSchema.safeParse(entry.location);
          const organizer = objectSchema.safeParse(entry.organizer);
          const offers = objectSchema.safeParse(
            Array.isArray(entry.offers) ? entry.offers[0] : entry.offers,
          );
          const startAt = date(entry.startDate);
          const endAt = date(entry.endDate);
          const title = text(entry.name);
          const description = text(entry.description);
          const url = text(entry.url) ?? pageUrl;
          const offerPrice = offers.success
            ? Number(offers.data.price)
            : Number.NaN;
          const language = text(entry.inLanguage)?.toLowerCase();
          const currency = offers.success
            ? supportedCurrency(offers.data.priceCurrency)
            : undefined;
          if (!startAt || !title) return [];
          const candidate = rawEventSchema.safeParse({
            externalId: text(entry['@id']),
            title,
            description,
            startAt,
            ...(endAt ? { endAt } : {}),
            venue: location.success
              ? {
                  name: text(location.data.name),
                  address: address(location.data.address),
                }
              : undefined,
            organizer: organizer.success
              ? {
                  name: text(organizer.data.name),
                  url: text(organizer.data.url),
                }
              : undefined,
            eventUrl: canonicalUrl(new URL(url, pageUrl).toString()),
            categories: inferCategories(
              `${title} ${description ?? ''} ${text(entry.keywords) ?? ''}`,
              categories,
            ),
            language: language?.startsWith('cs')
              ? 'cs'
              : language?.startsWith('en')
                ? 'en'
                : undefined,
            imageUrl: text(
              Array.isArray(entry.image) ? entry.image[0] : entry.image,
            ),
            price:
              offers.success && Number.isFinite(offerPrice) && currency
                ? {
                    amount: offerPrice,
                    currency,
                    free: offerPrice === 0,
                  }
                : undefined,
            registrationUrl: offers.success ? text(offers.data.url) : undefined,
            registrationDeadline: offers.success
              ? date(offers.data.validThrough)
              : undefined,
            cancelled: text(entry.eventStatus)?.includes('Cancelled') ?? false,
            raw: entry,
          });
          return candidate.success ? [candidate.data] : [];
        });
    } catch {
      return [];
    }
  });
};

export class JsonLdEventSource implements EventSource {
  public constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly url: string,
    public readonly intervalMinutes: number,
    public readonly enabled: boolean,
    private readonly categories: EventCategory[] = ['other'],
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  public async fetchUpcomingEvents(
    options: { signal?: AbortSignal; now?: Date } = {},
  ): Promise<RawEvent[]> {
    const response = await retryTransient(
      async () => {
        const timeout = AbortSignal.timeout(30_000);
        const signal = options.signal
          ? AbortSignal.any([options.signal, timeout])
          : timeout;
        const candidate = await this.fetcher(this.url, {
          signal,
          headers: { 'user-agent': 'Watcher Brno Events Agent/1.0' },
        });
        if (!candidate.ok)
          throw new Error(
            `HTTP ${candidate.status} from ${new URL(this.url).hostname}`,
          );
        return candidate;
      },
      options.signal ? { signal: options.signal } : {},
    );
    const now = options.now ?? new Date();
    return parseJsonLdEvents(
      await response.text(),
      this.url,
      this.categories,
    ).filter((event) =>
      event.endAt ? event.endAt >= now : event.startAt >= now,
    );
  }
}
