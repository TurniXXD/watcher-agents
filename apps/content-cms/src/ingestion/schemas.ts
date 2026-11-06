import { z } from 'zod';
import { isValidTimeZone } from '../lib/time';
import {
  platformPostTypes,
  socialPlatforms,
  socialPostTypes,
} from '../collections/social-posts';

const httpUrl = z
  .url({ protocol: /^https?$/u })
  .max(2048)
  .meta({ format: 'uri' });

const isoDateTime = z.iso.datetime({ offset: true }).meta({
  description: 'ISO 8601 timestamp with UTC offset',
  example: '2026-11-20T18:00:00+01:00',
});

const isoDate = z.iso.date().meta({ example: '2026-10-01' });

const shortText = (max: number) => z.string().trim().min(1).max(max);
const tags = z.array(shortText(60)).max(30).default([]);

export const externalIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[\x21-\x7e]+$/u, 'Printable ASCII without spaces')
  .meta({
    description:
      'Stable identifier from the bot. Re-sending the same id updates the same record.',
  });

export const sourceReferenceSchema = z
  .object({
    title: shortText(300),
    url: httpUrl,
    publisher: shortText(200).optional(),
    accessedAt: isoDateTime.optional(),
  })
  .meta({ id: 'SourceReference' });

export const aiProvenanceSchema = z
  .object({
    generatedByAI: z.boolean(),
    generator: shortText(100).optional(),
    model: shortText(100).optional(),
    generatedAt: isoDateTime.optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .meta({ id: 'AiProvenance' });

export const foodEvidenceSchema = z
  .object({
    text: shortText(500).meta({
      description: 'Verbatim source snippet supporting the classification.',
    }),
    sourceUrl: httpUrl.optional(),
  })
  .meta({ id: 'FoodEvidence' });

export const eventIngestItemSchema = z
  .object({
    externalId: externalIdSchema,
    title: shortText(300),
    summary: z.string().trim().max(1000).optional().meta({
      description: 'Original short summary. Do not copy organiser text.',
    }),
    descriptionText: z.string().trim().max(5000).optional().meta({
      description:
        'Original plain-text description. Stored as rich text for editors.',
    }),
    sourceExcerpt: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .meta({ description: 'Internal context for editors; never published.' }),
    startsAt: isoDateTime,
    endsAt: isoDateTime.optional(),
    timezone: z
      .string()
      .default('Europe/Prague')
      .refine(isValidTimeZone, 'Unknown IANA time zone'),
    city: shortText(120).default('Brno'),
    venueName: shortText(300).optional(),
    address: shortText(500).optional(),
    category: shortText(60).default('other'),
    tags,
    organizerName: shortText(300).optional(),
    sourceUrl: httpUrl.meta({
      description: 'Canonical organiser or source event page.',
    }),
    registrationUrl: httpUrl.optional(),
    sourceImageUrl: httpUrl.optional().meta({
      description: 'Recorded for editors; never republished automatically.',
    }),
    isFree: z
      .boolean()
      .nullable()
      .optional()
      .meta({ description: 'Free admission. Omit or null when unknown.' }),
    price: z.number().nonnegative().max(1_000_000).nullable().optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/u)
      .nullable()
      .optional()
      .meta({ example: 'CZK' }),
    freeFood: z.enum(['yes', 'no', 'unknown']).default('unknown'),
    foodDetails: z.string().trim().max(300).nullable().optional(),
    foodEvidence: z.array(foodEvidenceSchema).max(10).default([]),
    eventStatus: z
      .enum(['scheduled', 'cancelled', 'postponed'])
      .default('scheduled'),
    verifiedAt: isoDateTime.optional().meta({
      description: 'When the bot last confirmed the event at its source.',
    }),
    sourceReferences: z.array(sourceReferenceSchema).max(10).default([]),
    aiProvenance: aiProvenanceSchema.optional(),
  })
  .superRefine((item, context) => {
    if (item.endsAt && new Date(item.endsAt) < new Date(item.startsAt)) {
      context.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'endsAt must not be before startsAt',
      });
    }
    if (item.freeFood !== 'unknown' && item.foodEvidence.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['foodEvidence'],
        message:
          'freeFood yes/no requires explicit source evidence; send unknown otherwise',
      });
    }
    if (
      item.price !== undefined &&
      item.price !== null &&
      item.price > 0 &&
      !item.currency
    ) {
      context.addIssue({
        code: 'custom',
        path: ['currency'],
        message: 'currency is required with a price',
      });
    }
  })
  .meta({ id: 'EventIngestItem' });

export const articleIngestItemSchema = z
  .object({
    externalId: externalIdSchema,
    title: shortText(300),
    excerpt: z.string().trim().max(600).optional(),
    contentText: z.string().trim().max(100_000).optional(),
    author: shortText(200).optional(),
    categories: z.array(shortText(60)).max(10).default([]),
    tags,
    sourceReferences: z.array(sourceReferenceSchema).max(30).default([]),
    aiProvenance: aiProvenanceSchema.optional(),
  })
  .meta({ id: 'ArticleIngestItem' });

export const newsIngestItemSchema = z
  .object({
    externalId: externalIdSchema,
    title: shortText(300),
    summary: z.string().trim().max(1500).optional(),
    bodyText: z.string().trim().max(50_000).optional(),
    originalUrl: httpUrl,
    publisher: shortText(200).optional(),
    originalPublishedAt: isoDateTime.optional(),
    category: shortText(60).optional(),
    tags,
    sourceReferences: z.array(sourceReferenceSchema).max(10).default([]),
    aiProvenance: aiProvenanceSchema.optional(),
  })
  .meta({ id: 'NewsIngestItem' });

export const publicationIngestItemSchema = z
  .object({
    externalId: externalIdSchema,
    title: shortText(500),
    authors: z.array(shortText(200)).max(200).default([]),
    abstract: z.string().trim().max(20_000).optional(),
    aiSummary: z.string().trim().max(3000).optional(),
    doi: z
      .string()
      .trim()
      .regex(/^10\.\d{4,9}\/\S+$/u)
      .optional()
      .meta({ example: '10.1000/xyz123' }),
    journal: shortText(300).optional(),
    publicationDate: isoDate.optional(),
    publicationUrl: httpUrl.optional(),
    researchTopics: z.array(shortText(100)).max(30).default([]),
    sourceReferences: z.array(sourceReferenceSchema).max(10).default([]),
    aiProvenance: aiProvenanceSchema.optional(),
  })
  .meta({ id: 'PublicationIngestItem' });

export const socialPostIngestItemSchema = z
  .object({
    externalId: externalIdSchema,
    title: shortText(200),
    content: shortText(5000),
    platform: z.enum(socialPlatforms),
    postType: z.enum(socialPostTypes),
    hashtags: z
      .array(
        z
          .string()
          .trim()
          .regex(/^#?[\p{L}\p{N}_]{1,100}$/u),
      )
      .max(30)
      .default([]),
    targetUrl: httpUrl.optional(),
    aiProvenance: aiProvenanceSchema.optional(),
  })
  .superRefine((item, context) => {
    if (!platformPostTypes[item.platform].includes(item.postType)) {
      context.addIssue({
        code: 'custom',
        path: ['postType'],
        message: `${item.postType} is not supported on ${item.platform}`,
      });
    }
  })
  .meta({ id: 'SocialPostIngestItem' });

export type EventIngestItem = z.infer<typeof eventIngestItemSchema>;
export type ArticleIngestItem = z.infer<typeof articleIngestItemSchema>;
export type NewsIngestItem = z.infer<typeof newsIngestItemSchema>;
export type PublicationIngestItem = z.infer<typeof publicationIngestItemSchema>;
export type SocialPostIngestItem = z.infer<typeof socialPostIngestItemSchema>;

/** Envelope: items are validated one by one so one bad item does not fail the batch. */
export const ingestBatchEnvelopeSchema = z.object({
  items: z.array(z.unknown()).min(1),
});

export const ingestBatchRequestSchema = <T extends z.ZodType>(
  item: T,
  id: string,
) => z.object({ items: z.array(item).min(1).max(100) }).meta({ id });

export const ingestOutcomes = [
  'created',
  'updated',
  'proposed',
  'unchanged',
  'skipped',
  'failed',
] as const;

export const ingestItemResultSchema = z
  .object({
    index: z.number().int().nonnegative(),
    externalId: z.string().nullable(),
    outcome: z.enum(ingestOutcomes),
    id: z.string().optional(),
    slug: z.string().optional(),
    reason: z.string().optional().meta({
      description: 'Machine-readable reason for skipped or failed items.',
    }),
    retryable: z.boolean().optional(),
    details: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional(),
  })
  .meta({ id: 'IngestItemResult' });

export const ingestRunSchema = z
  .object({
    runId: z.string(),
    status: z.enum(['running', 'succeeded', 'partial', 'failed']),
    collection: z.string(),
    startedAt: z.string(),
    completedAt: z.string().nullable(),
    counts: z.object({
      received: z.number().int(),
      created: z.number().int(),
      updated: z.number().int(),
      proposed: z.number().int(),
      skipped: z.number().int(),
      failed: z.number().int(),
    }),
    results: z.array(ingestItemResultSchema),
  })
  .meta({ id: 'IngestRun' });
export type IngestRunResponse = z.infer<typeof ingestRunSchema>;
export type IngestItemResult = z.infer<typeof ingestItemResultSchema>;
