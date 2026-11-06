import { z } from 'zod';

const booleanParam = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

const dateParam = z
  .string()
  .max(40)
  .regex(
    /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:\d{2}))?$/u,
    'Use YYYY-MM-DD or an ISO 8601 timestamp with offset',
  );

const limitParam = z.coerce
  .number()
  .int()
  .min(1)
  .max(100)
  .default(20)
  .meta({ description: 'Page size (1–100).' });
const cursorParam = z.string().max(512).optional().meta({
  description:
    'Opaque cursor from `nextCursor` of the previous page. Only valid with the same sort.',
});

export const eventSorts = ['startsAt', '-startsAt', '-updatedAt'] as const;

export const eventsQuerySchema = z
  .object({
    city: z.string().trim().min(1).max(120).default('brno').meta({
      description:
        'City (case and diacritics insensitive). Use `all` for every city.',
      example: 'brno',
    }),
    category: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .optional()
      .meta({ example: 'ai' }),
    from: dateParam.optional().meta({
      description:
        'Events starting or still running at/after this point. Dates are calendar days in Europe/Prague. Defaults to now.',
      example: '2026-11-20',
    }),
    to: dateParam.optional().meta({
      description:
        'Events starting before the end of this day (Europe/Prague) or before this timestamp.',
      example: '2026-11-30',
    }),
    q: z
      .string()
      .trim()
      .min(2)
      .max(100)
      .optional()
      .meta({ description: 'Search in title, summary, venue, and organizer.' }),
    limit: limitParam,
    cursor: cursorParam,
    sort: z
      .enum(eventSorts)
      .default('startsAt')
      .meta({ description: 'Default: nearest upcoming first.' }),
    free: booleanParam.optional().meta({
      description: '`true`: free admission; `false`: explicitly paid.',
    }),
    freeFood: booleanParam.optional().meta({
      description:
        '`true`: only events whose source explicitly confirms free food (`freeFood: yes`).',
    }),
    featured: booleanParam.optional(),
  })
  .strict();
export type EventsQuery = z.infer<typeof eventsQuerySchema>;

export const categoriesQuerySchema = z
  .object({ city: eventsQuerySchema.shape.city })
  .strict();

export const contentListQuerySchema = z
  .object({
    q: z.string().trim().min(2).max(100).optional(),
    category: z.string().trim().min(1).max(60).optional(),
    tag: z.string().trim().min(1).max(60).optional(),
    limit: limitParam,
    cursor: cursorParam,
  })
  .strict();
export type ContentListQuery = z.infer<typeof contentListQuerySchema>;

const isoTimestamp = z
  .string()
  .meta({ format: 'date-time', example: '2026-11-20T17:00:00.000Z' });
const nullableTimestamp = isoTimestamp.nullable();

export const publicEventSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    summary: z.string().nullable(),
    description: z.string().nullable().meta({
      description:
        'Plain text; safe to render as text. Paragraphs separated by blank lines.',
    }),
    startsAt: isoTimestamp,
    endsAt: nullableTimestamp,
    timezone: z.string().meta({ example: 'Europe/Prague' }),
    city: z.string(),
    venueName: z.string().nullable(),
    address: z.string().nullable(),
    category: z.string(),
    tags: z.array(z.string()),
    organizerName: z.string().nullable(),
    sourceUrl: z.string().meta({
      format: 'uri',
      description: 'Original organiser/source page (attribution).',
    }),
    registrationUrl: z.string().nullable(),
    imageUrl: z.string().nullable().meta({
      description:
        'Only images with publication rights; never scraped source images.',
    }),
    isFree: z
      .boolean()
      .nullable()
      .meta({ description: 'Free admission; null when unknown.' }),
    price: z.number().nullable(),
    currency: z.string().nullable(),
    freeFood: z.enum(['yes', 'no', 'unknown']),
    foodDetails: z.string().nullable(),
    status: z.enum(['scheduled', 'cancelled', 'postponed']),
    featured: z.boolean(),
    lastVerifiedAt: nullableTimestamp,
    updatedAt: isoTimestamp,
  })
  .meta({ id: 'PublicEvent' });
export type PublicEvent = z.infer<typeof publicEventSchema>;

const sourceSchema = z
  .object({
    title: z.string(),
    url: z.string(),
    publisher: z.string().nullable(),
  })
  .meta({ id: 'PublicSource' });

export const publicArticleSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    excerpt: z.string().nullable(),
    coverImageUrl: z.string().nullable(),
    author: z.string().nullable(),
    categories: z.array(z.string()),
    tags: z.array(z.string()),
    sources: z.array(sourceSchema),
    aiGenerated: z.boolean(),
    publishedAt: nullableTimestamp,
    updatedAt: isoTimestamp,
  })
  .meta({ id: 'PublicArticle' });

export const publicArticleDetailSchema = publicArticleSchema
  .extend({
    contentText: z
      .string()
      .nullable()
      .meta({ description: 'Plain-text rendering of the article.' }),
    content: z.unknown().nullable().meta({
      description:
        'Payload Lexical JSON. Render with @payloadcms/richtext-lexical/react.',
    }),
    seo: z.object({
      title: z.string().nullable(),
      description: z.string().nullable(),
      noIndex: z.boolean(),
    }),
  })
  .meta({ id: 'PublicArticleDetail' });

export const publicNewsSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    summary: z.string().nullable(),
    originalUrl: z.string(),
    publisher: z.string().nullable(),
    originalPublishedAt: nullableTimestamp,
    category: z.string().nullable(),
    tags: z.array(z.string()),
    aiGenerated: z.boolean(),
    publishedAt: nullableTimestamp,
    updatedAt: isoTimestamp,
  })
  .meta({ id: 'PublicNews' });

export const publicPublicationSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    authors: z.array(z.string()),
    summary: z.string().nullable().meta({
      description: 'Original AI-assisted summary reviewed by an editor.',
    }),
    doi: z.string().nullable(),
    journal: z.string().nullable(),
    publicationDate: nullableTimestamp,
    publicationUrl: z.string().nullable(),
    researchTopics: z.array(z.string()),
    aiGenerated: z.boolean(),
    publishedAt: nullableTimestamp,
    updatedAt: isoTimestamp,
  })
  .meta({ id: 'PublicPublication' });

export const listResponseSchema = <T extends z.ZodType>(item: T, id: string) =>
  z
    .object({
      data: z.array(item),
      nextCursor: z.string().nullable(),
      meta: z.object({ limit: z.number().int() }),
    })
    .meta({ id });

export const detailResponseSchema = <T extends z.ZodType>(
  item: T,
  id: string,
) => z.object({ data: item }).meta({ id });

export const categoriesResponseSchema = z
  .object({
    data: z.array(z.object({ slug: z.string(), label: z.string() })),
    meta: z.object({ city: z.string() }),
  })
  .meta({ id: 'EventCategoriesResponse' });

export const errorResponseSchema = z
  .object({
    error: z.object({
      code: z.string().meta({ example: 'validation_failed' }),
      message: z.string(),
      requestId: z.string().optional(),
      details: z
        .array(z.object({ path: z.string(), message: z.string() }))
        .optional(),
    }),
  })
  .meta({ id: 'Error' });
