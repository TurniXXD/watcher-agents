import { z } from 'zod';

export const stockBriefingCategories = [
  'STOCK_CATALYST',
  'STOCK_THESIS_CHANGE',
  'STOCK_RECOMMENDATION_CHANGE',
  'STOCK_INSIDER_ACTIVITY',
  'STOCK_PRICE_ANOMALY',
  'STOCK_EARNINGS',
  'STOCK_REGULATORY_EVENT',
  'STOCK_DISCOVERY',
  'STOCK_WATCHLIST_CHANGE',
] as const;

export const medicalBriefingCategories = [
  'MEDICAL_TRIAL',
  'MEDICAL_APPROVAL',
  'MEDICAL_SAFETY',
  'MEDICAL_GUIDELINE',
  'MEDICAL_RESEARCH',
  'MEDICAL_TECHNOLOGY',
  'MEDICAL_PUBLIC_HEALTH',
] as const;

export const watcherBotIdSchema = z.enum(['stocks', 'medical']);
export type WatcherBotId = z.infer<typeof watcherBotIdSchema>;

export const briefingEventStatusSchema = z.enum([
  'NEW',
  'DEVELOPING',
  'UNCHANGED',
  'RESOLVED',
]);
export type BriefingEventStatus = z.infer<typeof briefingEventStatusSchema>;

export const briefingConfidenceSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export type BriefingConfidence = z.infer<typeof briefingConfidenceSchema>;

const identifierSchema = z.string().trim().min(1).max(200);
const textSchema = z.string().trim().min(1);
const scoreSchema = z.number().int().min(0).max(100);
const timestampSchema = z.iso.datetime({ offset: true });

type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const briefingEntitySchema = z
  .object({
    type: identifierSchema,
    id: identifierSchema.optional(),
    name: textSchema.max(300),
    ticker: z
      .string()
      .trim()
      .regex(/^[A-Z0-9][A-Z0-9.-]{0,19}$/)
      .optional(),
  })
  .strict();
export type BriefingEntity = z.infer<typeof briefingEntitySchema>;

export const briefingEventSchema = z
  .object({
    id: identifierSchema,
    watcherBot: watcherBotIdSchema,
    externalEventId: identifierSchema.optional(),
    occurredAt: timestampSchema.optional(),
    publishedAt: timestampSchema.optional(),
    detectedAt: timestampSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    category: identifierSchema,
    subcategory: identifierSchema.optional(),
    title: textSchema.max(500),
    summary: textSchema.max(10_000),
    importance: scoreSchema,
    novelty: scoreSchema,
    relevance: scoreSchema,
    urgency: scoreSchema,
    actionable: z.boolean(),
    action: textSchema.max(1_000).optional(),
    entities: z.array(briefingEntitySchema).max(100),
    tags: z.array(identifierSchema).max(100),
    sourceUrls: z.array(z.url()).max(100),
    primarySource: identifierSchema.optional(),
    confidence: briefingConfidenceSchema,
    status: briefingEventStatusSchema,
    deduplicationKey: identifierSchema.max(500).optional(),
    relatedEventIds: z.array(identifierSchema).max(100).optional(),
    metadata: z.record(z.string(), jsonValueSchema).optional(),
  })
  .strict()
  .superRefine((event, context) => {
    const allowedCategories =
      event.watcherBot === 'stocks'
        ? stockBriefingCategories
        : medicalBriefingCategories;
    if (!(allowedCategories as readonly string[]).includes(event.category)) {
      context.addIssue({
        code: 'custom',
        path: ['category'],
        message: `Category ${event.category} is not registered for ${event.watcherBot}`,
      });
    }
  });

export type BriefingEvent = z.infer<typeof briefingEventSchema>;

export type WatcherRegistration = {
  id: WatcherBotId;
  displayName: string;
  producerKind: 'STOCKS' | 'PUBLICATIONS';
  categories: readonly string[];
};

export const watcherRegistry = Object.freeze({
  stocks: Object.freeze({
    id: 'stocks',
    displayName: 'Stocks',
    producerKind: 'STOCKS',
    categories: stockBriefingCategories,
  }),
  medical: Object.freeze({
    id: 'medical',
    displayName: 'Medical',
    producerKind: 'PUBLICATIONS',
    categories: medicalBriefingCategories,
  }),
} satisfies Record<WatcherBotId, WatcherRegistration>);

export const registeredWatcherBots = watcherBotIdSchema.options;

export const getWatcherRegistration = (
  watcherBot: WatcherBotId,
): WatcherRegistration => watcherRegistry[watcherBot];

export const briefingConfidenceFromScore = (
  confidence: number,
): BriefingConfidence =>
  confidence >= 0.8 ? 'HIGH' : confidence >= 0.5 ? 'MEDIUM' : 'LOW';

export type BriefingEventQuery = {
  watcherBots?: readonly WatcherBotId[];
  statuses?: readonly BriefingEventStatus[];
  detectedAfter?: Date;
  detectedThrough?: Date;
  limit?: number;
};

export type SavedBriefingEvent = {
  event: BriefingEvent;
  created: boolean;
};

export type BriefingEventRepository = {
  save(event: unknown): Promise<SavedBriefingEvent>;
  list(query?: BriefingEventQuery): Promise<BriefingEvent[]>;
};
