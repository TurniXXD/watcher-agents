import { z } from 'zod';

export const eventCategories = [
  'science',
  'biology',
  'medicine',
  'biotech',
  'ai',
  'programming',
  'software',
  'hardware',
  'iot',
  'maker',
  'engineering',
  'startup',
  'entrepreneurship',
  'business',
  'investing',
  'university',
  'student',
  'lecture',
  'workshop',
  'hackathon',
  'networking',
  'conference',
  'culture',
  'music',
  'film',
  'art',
  'food',
  'outdoors',
  'volunteering',
  'social',
  'other',
] as const;
export const eventCategorySchema = z.enum(eventCategories);
export type EventCategory = z.infer<typeof eventCategorySchema>;

export const rawEventSchema = z.object({
  externalId: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1),
  description: z.string().trim().optional(),
  startAt: z.date(),
  endAt: z.date().optional(),
  venue: z
    .object({
      name: z.string().optional(),
      address: z.string().optional(),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
    })
    .optional(),
  organizer: z
    .object({ name: z.string().optional(), url: z.url().optional() })
    .optional(),
  eventUrl: z.url(),
  categories: z.array(eventCategorySchema).default(['other']),
  language: z.enum(['cs', 'en', 'other']).optional(),
  price: z
    .object({
      amount: z.number().nonnegative().optional(),
      currency: z.enum(['CZK', 'EUR']).optional(),
      free: z.boolean().optional(),
      text: z.string().optional(),
    })
    .optional(),
  registrationRequired: z.boolean().optional(),
  registrationUrl: z.url().optional(),
  registrationDeadline: z.date().optional(),
  imageUrl: z.url().optional(),
  recurring: z.boolean().default(false),
  cancelled: z.boolean().default(false),
  sourceUpdatedAt: z.date().optional(),
  raw: z.unknown().optional(),
});
export type RawEvent = z.infer<typeof rawEventSchema>;

export const brnoEventSchema = rawEventSchema.extend({
  id: z.uuid(),
  city: z.literal('Brno'),
  sourceReferences: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        url: z.url(),
        eventUrl: z.url(),
      }),
    )
    .min(1),
  discoveredAt: z.date(),
  updatedAt: z.date(),
  relevanceScore: z.number().int().min(0).max(100),
  relevanceReasons: z.array(z.string()),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
});
export type BrnoEvent = z.infer<typeof brnoEventSchema>;

export type EventSource = {
  id: string;
  name: string;
  url: string;
  intervalMinutes: number;
  enabled: boolean;
  fetchUpcomingEvents(options?: {
    signal?: AbortSignal;
    now?: Date;
  }): Promise<RawEvent[]>;
};
