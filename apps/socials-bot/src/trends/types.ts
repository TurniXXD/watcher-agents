import { createHash } from 'node:crypto';
import { z } from 'zod';

export const trendSourceIdSchema = z.enum([
  'GOOGLE_TRENDS',
  'REDDIT',
  'YOUTUBE',
  'TIKTOK',
  'INSTAGRAM',
  'BLUESKY',
  'HACKERNEWS',
  'MASTODON',
  'RSS',
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
  author: z.string().trim().min(1).max(300).optional(),
  keywords: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
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

const trackingParameters = new Set([
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'ref',
  'referrer',
]);

export const canonicalTrendUrl = (value: string): string => {
  const url = new URL(value);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey.startsWith('utm_') ||
      trackingParameters.has(normalizedKey)
    ) {
      url.searchParams.delete(key);
    }
  }
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname !== '/') {
    url.pathname = url.pathname.replace(/\/+$/u, '');
  }
  return url.toString();
};

export const trendContentFingerprint = (signal: TrendSignal): string =>
  createHash('sha256')
    .update(canonicalTrendUrl(signal.sourceUrl).toLocaleLowerCase('en-US'))
    .digest('hex');

export const deduplicateTrendSignals = (
  signals: readonly TrendSignal[],
): TrendSignal[] => {
  const unique = new Map<string, TrendSignal>();
  for (const signal of signals) {
    const key = trendContentFingerprint(signal);
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, signal);
      continue;
    }
    const existingMetricCount = Object.keys(existing.metrics).length;
    const candidateMetricCount = Object.keys(signal.metrics).length;
    if (candidateMetricCount > existingMetricCount) {
      unique.set(key, {
        ...signal,
        metadata: {
          ...signal.metadata,
          duplicateSources: [existing.source],
        },
      });
      continue;
    }
    unique.set(key, {
      ...existing,
      metadata: {
        ...existing.metadata,
        duplicateSources: [
          ...new Set([
            ...((existing.metadata?.duplicateSources as string[] | undefined) ??
              []),
            signal.source,
          ]),
        ],
      },
    });
  }
  return [...unique.values()];
};

export const safeExternalExcerpt = (
  value: string | undefined,
): string | undefined => {
  const normalized = value
    ?.replace(/<script[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style[\s\S]*?<\/style>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll(/\s+/gu, ' ')
    .trim()
    .slice(0, 1_200);
  return normalized || undefined;
};
