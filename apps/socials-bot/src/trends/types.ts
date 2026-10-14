import { createHash } from 'node:crypto';
import { z } from 'zod';

export const trendSourceIdSchema = z.enum([
  'GOOGLE_TRENDS',
  'REDDIT',
  'YOUTUBE',
  'TIKTOK',
  'INSTAGRAM',
  'MANUAL',
]);
export type TrendSourceId = z.infer<typeof trendSourceIdSchema>;

export const trendRegionSchema = z.enum(['US', 'CZ', 'GLOBAL', 'UNKNOWN']);
export type TrendRegion = z.infer<typeof trendRegionSchema>;

export const trendMetricsSchema = z.object({
  views: z.number().int().nonnegative().optional(),
  likes: z.number().int().nonnegative().optional(),
  comments: z.number().int().nonnegative().optional(),
  shares: z.number().int().nonnegative().optional(),
  searchInterest: z.number().nonnegative().optional(),
});

export const trendSignalSchema = z.object({
  externalId: z.string().trim().min(1).max(500),
  source: trendSourceIdSchema,
  sourceUrl: z.url(),
  title: z.string().trim().min(2).max(500),
  description: z.string().trim().max(2_000).optional(),
  region: trendRegionSchema,
  publishedAt: z.date().optional(),
  collectedAt: z.date(),
  metrics: trendMetricsSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type TrendSignal = z.infer<typeof trendSignalSchema>;

export type TrendSourceContext = {
  keywords: readonly string[];
  subreddits: readonly string[];
  youtubeChannelIds: readonly string[];
  regions: readonly TrendRegion[];
  now: Date;
};

export type TrendSourceResult = {
  source: TrendSourceId;
  availability:
    | 'ACTIVE'
    | 'DISABLED'
    | 'UNAVAILABLE'
    | 'CREDENTIALS_REQUIRED'
    | 'QUOTA_EXHAUSTED'
    | 'ERROR';
  signals: TrendSignal[];
  quotaUsed: number;
  error?: string;
};

export type TrendSource = {
  id: TrendSourceId;
  name: string;
  enabled: boolean;
  collect(context: TrendSourceContext): Promise<TrendSourceResult>;
};

export const trendFingerprint = (signal: TrendSignal): string =>
  createHash('sha256')
    .update(
      [signal.source, signal.externalId, signal.region]
        .join('\u0000')
        .toLocaleLowerCase('en-US'),
    )
    .digest('hex');

export const safeExternalExcerpt = (
  value: string | undefined,
): string | undefined => {
  const normalized = value?.replaceAll(/\s+/gu, ' ').trim().slice(0, 1_200);
  return normalized || undefined;
};
