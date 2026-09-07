import { z } from 'zod';
import type { WatchItem, WatcherKind } from './types.js';

export const observationSourceTypeSchema = z.enum([
  'REGULATORY',
  'INVESTOR_RELATIONS',
  'NEWS',
  'MARKET_DATA',
  'ANALYST',
  'PUBLICATION',
  'OTHER',
]);
export type ObservationSourceType = z.infer<typeof observationSourceTypeSchema>;

export const normalizedObservationSchema = z.object({
  id: z.string().min(1),
  watcherKind: z.enum(['STOCKS', 'PUBLICATIONS', 'NEWS']),
  ticker: z.string().min(1).nullable(),
  source: z.string().min(1),
  sourceType: observationSourceTypeSchema,
  sourceUrl: z.url(),
  primarySource: z.boolean(),
  publishedAt: z.date().nullable(),
  discoveredAt: z.date(),
  eventAt: z.date().nullable(),
  category: z.string().min(1),
  headline: z.string().min(1),
  rawText: z.string().min(1),
  normalizedFacts: z.record(z.string(), z.unknown()),
  entities: z.array(z.string()),
  reliability: z.number().min(0).max(1),
  metadata: z.record(z.string(), z.unknown()),
});

export type NormalizedObservation = z.infer<typeof normalizedObservationSchema>;

const metadataTicker = (item: WatchItem): string | null => {
  const symbol = item.metadata.symbol;
  return typeof symbol === 'string' && symbol.trim()
    ? symbol.trim().toUpperCase()
    : null;
};

export const normalizeObservation = (
  watcherKind: WatcherKind,
  item: WatchItem,
  discoveredAt = new Date(),
): NormalizedObservation =>
  normalizedObservationSchema.parse({
    id: item.id,
    watcherKind,
    ticker: metadataTicker(item),
    source: item.source,
    sourceType: item.sourceType ?? 'OTHER',
    sourceUrl: item.url,
    primarySource: item.primarySource ?? false,
    publishedAt: item.publishedAt ?? null,
    discoveredAt,
    eventAt: item.eventAt ?? null,
    category: item.category ?? 'OTHER',
    headline: item.title,
    rawText: item.content,
    normalizedFacts: item.normalizedFacts ?? {},
    entities: item.entities ?? [],
    reliability: item.reliability ?? 0.5,
    metadata: item.metadata,
  });
