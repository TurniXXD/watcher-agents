import { createHash } from 'node:crypto';
import { classifyFreeFood } from '../domain/free-food.js';

/** Brno event row as stored by the agent (subset used for the CMS). */
export type CmsSourceEvent = {
  id: string;
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date | null;
  venueName: string | null;
  venueAddress: string | null;
  city: string;
  organizerName: string | null;
  categories: string[];
  priceAmount: number | null;
  priceCurrency: string | null;
  priceFree: boolean | null;
  priceText: string | null;
  registrationRequired: boolean | null;
  registrationUrl: string | null;
  imageUrl: string | null;
  cancelled: boolean;
  lastSeenAt: Date;
  sourceLinks: Array<{
    sourceId: string;
    sourceName: string;
    eventUrl: string;
    firstSeenAt: Date;
    lastSeenAt: Date;
  }>;
};

/** Payload ingestion item; mirrors the CMS `EventIngestItem` OpenAPI schema. */
export type CmsEventItem = {
  externalId: string;
  title: string;
  summary: string;
  sourceExcerpt?: string;
  startsAt: string;
  endsAt?: string;
  timezone: 'Europe/Prague';
  city: string;
  venueName?: string;
  address?: string;
  category: string;
  tags: string[];
  organizerName?: string;
  sourceUrl: string;
  registrationUrl?: string;
  sourceImageUrl?: string;
  isFree?: boolean | null;
  price?: number | null;
  currency?: string | null;
  freeFood: 'yes' | 'no' | 'unknown';
  foodDetails?: string | null;
  foodEvidence: Array<{ text: string; sourceUrl?: string }>;
  eventStatus: 'scheduled' | 'cancelled';
  verifiedAt: string;
  sourceReferences: Array<{
    title: string;
    url: string;
    publisher: string;
    accessedAt: string;
  }>;
  aiProvenance: { generatedByAI: false; generator: 'brno-events-agent' };
};

const GENERIC_CATEGORIES = new Set([
  'other',
  'university',
  'student',
  'social',
]);

const httpUrl = (value: string | null | undefined): string | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
};

const bounded = (
  value: string | null | undefined,
  max: number,
): string | undefined => {
  const trimmed = value?.replace(/\s+/gu, ' ').trim();
  if (!trimmed) return undefined;
  return trimmed.length > max
    ? `${trimmed.slice(0, max - 1).trimEnd()}…`
    : trimmed;
};

export const primaryCategory = (categories: string[]): string =>
  categories.find((category) => !GENERIC_CATEGORIES.has(category)) ??
  categories[0] ??
  'other';

/**
 * Original, factual one-line summary. It never reuses the organiser's prose,
 * which stays internal as `sourceExcerpt` for editors.
 */
export const factualSummary = (event: CmsSourceEvent): string => {
  const category = primaryCategory(event.categories).replaceAll('-', ' ');
  const parts = [
    `${category.charAt(0).toUpperCase()}${category.slice(1)} event in ${event.city}`,
  ];
  if (event.venueName) parts.push(`at ${bounded(event.venueName, 120)}`);
  if (event.organizerName)
    parts.push(`organised by ${bounded(event.organizerName, 120)}`);
  const sentence = `${parts.join(' ')}.`;
  return event.registrationRequired
    ? `${sentence} Registration required.`
    : sentence;
};

export const toCmsEventItem = (event: CmsSourceEvent): CmsEventItem => {
  const links = [...event.sourceLinks].sort(
    (a, b) => a.firstSeenAt.getTime() - b.firstSeenAt.getTime(),
  );
  const sourceUrl = links.map((link) => httpUrl(link.eventUrl)).find(Boolean);
  if (!sourceUrl) throw new Error(`Event ${event.id} has no source URL`);
  const isFree = event.priceFree ?? (event.priceAmount === 0 ? true : null);
  const currency =
    event.priceCurrency && /^[A-Z]{3}$/u.test(event.priceCurrency)
      ? event.priceCurrency
      : null;
  const price =
    event.priceAmount !== null && (event.priceAmount === 0 || currency)
      ? event.priceAmount
      : null;
  const food = classifyFreeFood({
    title: event.title,
    description: event.description,
    priceText: event.priceText,
    isFree,
    sourceUrl,
  });
  const registrationUrl = httpUrl(event.registrationUrl);
  const sourceImageUrl = httpUrl(event.imageUrl);
  const excerpt = bounded(event.description, 600);
  const venueName = bounded(event.venueName, 300);
  const address = bounded(event.venueAddress, 500);
  const organizerName = bounded(event.organizerName, 300);
  return {
    externalId: `brno-event:${event.id}`,
    title: bounded(event.title, 300) ?? event.title.slice(0, 300),
    summary: factualSummary(event),
    ...(excerpt ? { sourceExcerpt: excerpt } : {}),
    startsAt: event.startAt.toISOString(),
    ...(event.endAt && event.endAt >= event.startAt
      ? { endsAt: event.endAt.toISOString() }
      : {}),
    timezone: 'Europe/Prague',
    city: event.city,
    ...(venueName ? { venueName } : {}),
    ...(address ? { address } : {}),
    category: primaryCategory(event.categories),
    tags: [...new Set(event.categories)].slice(0, 30),
    ...(organizerName ? { organizerName } : {}),
    sourceUrl,
    ...(registrationUrl ? { registrationUrl } : {}),
    ...(sourceImageUrl ? { sourceImageUrl } : {}),
    isFree,
    price,
    currency: price && price > 0 ? currency : null,
    freeFood: food.freeFood,
    foodDetails: food.foodDetails,
    foodEvidence: food.evidence,
    eventStatus: event.cancelled ? 'cancelled' : 'scheduled',
    verifiedAt: event.lastSeenAt.toISOString(),
    sourceReferences: links.slice(0, 10).flatMap((link) => {
      const url = httpUrl(link.eventUrl);
      return url
        ? [
            {
              title: link.sourceName,
              url,
              publisher: link.sourceName,
              accessedAt: link.lastSeenAt.toISOString(),
            },
          ]
        : [];
    }),
    aiProvenance: { generatedByAI: false, generator: 'brno-events-agent' },
  };
};

/**
 * Delivery hash. `verifiedAt` contributes only its UTC day, so an unchanged
 * event is re-confirmed to the CMS at most once a day instead of every poll.
 */
export const cmsItemHash = (item: CmsEventItem): string => {
  const { verifiedAt, sourceReferences, ...content } = item;
  return createHash('sha256')
    .update(
      JSON.stringify({
        ...content,
        verifiedDay: verifiedAt.slice(0, 10),
        sources: sourceReferences.map(({ url }) => url),
      }),
    )
    .digest('hex');
};
