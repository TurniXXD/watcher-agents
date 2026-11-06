import type { z } from 'zod';
import type { IngestibleCollection } from '../collections/ingestion';
import { articleManagedFields } from '../collections/articles';
import { eventManagedFields } from '../collections/events';
import { newsManagedFields } from '../collections/news';
import { publicationManagedFields } from '../collections/publications';
import { socialPostManagedFields } from '../collections/social-posts';
import { textToLexical } from '../lib/lexical';
import { contentSlug, eventSlug, slugify } from '../lib/slug';
import {
  articleIngestItemSchema,
  eventIngestItemSchema,
  newsIngestItemSchema,
  publicationIngestItemSchema,
  socialPostIngestItemSchema,
  type ArticleIngestItem,
  type EventIngestItem,
  type NewsIngestItem,
  type PublicationIngestItem,
  type SocialPostIngestItem,
} from './schemas';

export type IngestAdapter<T = unknown> = {
  collection: IngestibleCollection;
  schema: z.ZodType<T>;
  managedFields: readonly string[];
  richTextFields: readonly string[];
  criticalFields: readonly string[];
  /** Editorial-shaped values for bot-managed fields. */
  toManaged(item: T): Record<string, unknown>;
  /** Provenance fields that editors cannot edit; refreshed when the record is written. */
  toInternal(item: T): Record<string, unknown>;
  /** Natural slug; `null` for collections without public URLs. */
  baseSlug(item: T): string | null;
  /** Source URLs checked against blocked source domains. */
  sourceUrls(item: T): string[];
  /** Whether the item carries the "last verified" timestamp. */
  verifiedAt?(item: T): string | undefined;
};

const nullable = <V>(value: V | undefined): V | null => value ?? null;
const references = (
  items: {
    title: string;
    url: string;
    publisher?: string | undefined;
    accessedAt?: string | undefined;
  }[],
) =>
  items.map((reference) => ({
    title: reference.title,
    url: reference.url,
    publisher: nullable(reference.publisher),
    accessedAt: nullable(reference.accessedAt),
  }));
const provenance = (
  value:
    | {
        generatedByAI: boolean;
        generator?: string | undefined;
        model?: string | undefined;
        generatedAt?: string | undefined;
        notes?: string | undefined;
      }
    | undefined,
  botId?: string,
) => ({
  generatedByAI: value?.generatedByAI ?? false,
  generator: value?.generator ?? botId ?? null,
  model: nullable(value?.model),
  generatedAt: nullable(value?.generatedAt),
  notes: nullable(value?.notes),
});
const richText = (text: string | undefined) =>
  text ? textToLexical(text) : null;
const lowerTags = (tags: string[]) => [
  ...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)),
];

export const eventAdapter: IngestAdapter<EventIngestItem> = {
  collection: 'events',
  schema: eventIngestItemSchema,
  managedFields: eventManagedFields,
  richTextFields: ['description'],
  criticalFields: ['startsAt', 'endsAt', 'eventStatus'],
  toManaged: (item) => ({
    title: item.title,
    summary: nullable(item.summary),
    description: richText(item.descriptionText),
    startsAt: new Date(item.startsAt).toISOString(),
    endsAt: item.endsAt ? new Date(item.endsAt).toISOString() : null,
    timezone: item.timezone,
    city: item.city,
    venueName: nullable(item.venueName),
    address: nullable(item.address),
    category: slugify(item.category) || 'other',
    tags: lowerTags(item.tags),
    organizerName: nullable(item.organizerName),
    sourceUrl: item.sourceUrl,
    registrationUrl: nullable(item.registrationUrl),
    isFree: item.isFree ?? null,
    price: item.price ?? (item.isFree ? 0 : null),
    currency: item.currency ?? null,
    freeFood: item.freeFood,
    foodDetails: item.foodDetails ?? null,
    eventStatus: item.eventStatus,
  }),
  toInternal: (item) => ({
    sourceImageUrl: nullable(item.sourceImageUrl),
    sourceExcerpt: nullable(item.sourceExcerpt),
    foodEvidence: item.foodEvidence,
    sourceReferences: references(item.sourceReferences),
    aiProvenance: provenance(item.aiProvenance),
  }),
  baseSlug: (item) =>
    eventSlug(item.title, new Date(item.startsAt), item.timezone),
  sourceUrls: (item) => [
    item.sourceUrl,
    ...item.sourceReferences.map((reference) => reference.url),
  ],
  verifiedAt: (item) => item.verifiedAt,
};

export const articleAdapter: IngestAdapter<ArticleIngestItem> = {
  collection: 'articles',
  schema: articleIngestItemSchema,
  managedFields: articleManagedFields,
  richTextFields: ['content'],
  criticalFields: [],
  toManaged: (item) => ({
    title: item.title,
    excerpt: nullable(item.excerpt),
    content: richText(item.contentText),
    author: nullable(item.author),
    categories: lowerTags(item.categories),
    tags: lowerTags(item.tags),
  }),
  toInternal: (item) => ({
    sourceReferences: references(item.sourceReferences),
    aiProvenance: provenance(item.aiProvenance),
  }),
  baseSlug: (item) => contentSlug(item.title, 'article'),
  sourceUrls: (item) => item.sourceReferences.map((reference) => reference.url),
};

export const newsAdapter: IngestAdapter<NewsIngestItem> = {
  collection: 'news',
  schema: newsIngestItemSchema,
  managedFields: newsManagedFields,
  richTextFields: ['body'],
  criticalFields: [],
  toManaged: (item) => ({
    title: item.title,
    summary: nullable(item.summary),
    body: richText(item.bodyText),
    originalUrl: item.originalUrl,
    publisher: nullable(item.publisher),
    originalPublishedAt: item.originalPublishedAt
      ? new Date(item.originalPublishedAt).toISOString()
      : null,
    category: item.category ? slugify(item.category) : null,
    tags: lowerTags(item.tags),
  }),
  toInternal: (item) => ({
    sourceReferences: references(item.sourceReferences),
    aiProvenance: provenance(item.aiProvenance),
  }),
  baseSlug: (item) => contentSlug(item.title, 'news'),
  sourceUrls: (item) => [
    item.originalUrl,
    ...item.sourceReferences.map((reference) => reference.url),
  ],
};

export const publicationAdapter: IngestAdapter<PublicationIngestItem> = {
  collection: 'publications',
  schema: publicationIngestItemSchema,
  managedFields: publicationManagedFields,
  richTextFields: [],
  criticalFields: [],
  toManaged: (item) => ({
    title: item.title,
    authors: item.authors,
    abstract: nullable(item.abstract),
    aiSummary: nullable(item.aiSummary),
    doi: nullable(item.doi),
    journal: nullable(item.journal),
    publicationDate: item.publicationDate
      ? new Date(`${item.publicationDate}T00:00:00.000Z`).toISOString()
      : null,
    publicationUrl: nullable(item.publicationUrl),
    researchTopics: item.researchTopics,
  }),
  toInternal: (item) => ({
    sourceReferences: references(item.sourceReferences),
    aiProvenance: provenance(item.aiProvenance),
  }),
  baseSlug: (item) => contentSlug(item.title, 'publication'),
  sourceUrls: (item) => [
    ...(item.publicationUrl ? [item.publicationUrl] : []),
    ...item.sourceReferences.map((reference) => reference.url),
  ],
};

export const socialPostAdapter: IngestAdapter<SocialPostIngestItem> = {
  collection: 'social-posts',
  schema: socialPostIngestItemSchema,
  managedFields: socialPostManagedFields,
  richTextFields: [],
  criticalFields: [],
  toManaged: (item) => ({
    title: item.title,
    content: item.content,
    platform: item.platform,
    postType: item.postType,
    hashtags: item.hashtags.map((tag) =>
      tag.startsWith('#') ? tag.slice(1) : tag,
    ),
    targetUrl: nullable(item.targetUrl),
  }),
  toInternal: (item) => ({ aiProvenance: provenance(item.aiProvenance) }),
  baseSlug: () => null,
  sourceUrls: () => [],
};

export const ingestAdapters: Record<
  IngestibleCollection,
  IngestAdapter<never>
> = {
  events: eventAdapter as IngestAdapter<never>,
  articles: articleAdapter as IngestAdapter<never>,
  news: newsAdapter as IngestAdapter<never>,
  publications: publicationAdapter as IngestAdapter<never>,
  'social-posts': socialPostAdapter as IngestAdapter<never>,
};
