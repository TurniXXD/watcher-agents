import { publishableUsageRights } from '../collections/media';
import { lexicalToText } from '../lib/lexical';
import { DEFAULT_TIME_ZONE } from '../lib/time';
import type { PublicEvent } from './schemas';

type Doc = Record<string, unknown>;
type MediaDoc = {
  url?: string | null;
  visibility?: string;
  usageRights?: string;
  sizes?: Record<string, { url?: string | null }>;
};

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;
const iso = (value: unknown): string | null => {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];

/** Absolute URL for media that may be published; private or unlicensed media yields `null`. */
export const publicMediaUrl = (
  value: unknown,
  serverUrl: string,
  size?: string,
): string | null => {
  if (!value || typeof value !== 'object') return null;
  const media = value as MediaDoc;
  if (media.visibility !== 'public') return null;
  if (
    !(publishableUsageRights as readonly string[]).includes(
      media.usageRights ?? '',
    )
  )
    return null;
  const path = (size && media.sizes?.[size]?.url) || media.url;
  if (!path) return null;
  return new URL(path, serverUrl).toString();
};

export const toPublicEvent = (doc: Doc, serverUrl: string): PublicEvent => ({
  id: String(doc.id),
  slug: String(doc.slug),
  title: String(doc.title),
  summary: str(doc.summary),
  description: lexicalToText(doc.description),
  startsAt: iso(doc.startsAt) ?? '',
  endsAt: iso(doc.endsAt),
  timezone: str(doc.timezone) ?? DEFAULT_TIME_ZONE,
  city: str(doc.city) ?? '',
  venueName: str(doc.venueName),
  address: str(doc.address),
  category: str(doc.category) ?? 'other',
  tags: strings(doc.tags),
  organizerName: str(doc.organizerName),
  sourceUrl: String(doc.sourceUrl),
  registrationUrl: str(doc.registrationUrl),
  imageUrl: publicMediaUrl(doc.image, serverUrl, 'card'),
  isFree: typeof doc.isFree === 'boolean' ? doc.isFree : null,
  price: typeof doc.price === 'number' ? doc.price : null,
  currency: str(doc.currency),
  freeFood:
    doc.freeFood === 'yes' || doc.freeFood === 'no' ? doc.freeFood : 'unknown',
  foodDetails:
    doc.freeFood === 'yes' || doc.freeFood === 'no'
      ? str(doc.foodDetails)
      : null,
  status:
    doc.eventStatus === 'cancelled' || doc.eventStatus === 'postponed'
      ? doc.eventStatus
      : 'scheduled',
  featured: doc.featured === true,
  lastVerifiedAt: iso(doc.lastVerifiedAt),
  updatedAt: iso(doc.updatedAt) ?? '',
});

const sources = (value: unknown) =>
  Array.isArray(value)
    ? (value as Doc[])
        .filter(
          (entry) =>
            typeof entry.url === 'string' && typeof entry.title === 'string',
        )
        .map((entry) => ({
          title: String(entry.title),
          url: String(entry.url),
          publisher: str(entry.publisher),
        }))
    : [];

const aiGenerated = (doc: Doc) =>
  (doc.aiProvenance as { generatedByAI?: boolean } | undefined)
    ?.generatedByAI === true;

export const toPublicArticle = (doc: Doc, serverUrl: string) => ({
  id: String(doc.id),
  slug: String(doc.slug),
  title: String(doc.title),
  excerpt: str(doc.excerpt),
  coverImageUrl: publicMediaUrl(doc.coverImage, serverUrl, 'card'),
  author: str(doc.author),
  categories: strings(doc.categories),
  tags: strings(doc.tags),
  sources: sources(doc.sourceReferences),
  aiGenerated: aiGenerated(doc),
  publishedAt: iso(doc.publishedAt),
  updatedAt: iso(doc.updatedAt) ?? '',
});

export const toPublicArticleDetail = (doc: Doc, serverUrl: string) => {
  const seo = (doc.seo ?? {}) as Doc;
  return {
    ...toPublicArticle(doc, serverUrl),
    contentText: lexicalToText(doc.content),
    content: doc.content ?? null,
    seo: {
      title: str(seo.title),
      description: str(seo.description),
      noIndex: seo.noIndex === true,
    },
  };
};

export const toPublicNews = (doc: Doc) => ({
  id: String(doc.id),
  slug: String(doc.slug),
  title: String(doc.title),
  summary: str(doc.summary),
  originalUrl: String(doc.originalUrl),
  publisher: str(doc.publisher),
  originalPublishedAt: iso(doc.originalPublishedAt),
  category: str(doc.category),
  tags: strings(doc.tags),
  aiGenerated: aiGenerated(doc),
  publishedAt: iso(doc.publishedAt),
  updatedAt: iso(doc.updatedAt) ?? '',
});

export const toPublicPublication = (doc: Doc) => ({
  id: String(doc.id),
  slug: String(doc.slug),
  title: String(doc.title),
  authors: strings(doc.authors),
  summary: str(doc.aiSummary),
  doi: str(doc.doi),
  journal: str(doc.journal),
  publicationDate: iso(doc.publicationDate),
  publicationUrl: str(doc.publicationUrl),
  researchTopics: strings(doc.researchTopics),
  aiGenerated: aiGenerated(doc),
  publishedAt: iso(doc.publishedAt),
  updatedAt: iso(doc.updatedAt) ?? '',
});
