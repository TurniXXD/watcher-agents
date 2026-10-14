import { retryTransient } from '@watcher/core';
import { z } from 'zod';
import {
  safeExternalExcerpt,
  trendSignalSchema,
  type TrendSignal,
  type TrendSource,
  type TrendSourceContext,
  type TrendSourceId,
  type TrendSourceResult,
} from './types.js';

type Fetch = typeof fetch;

const youtubeSearchSchema = z.object({
  items: z.array(
    z.object({
      id: z.object({ videoId: z.string().min(1) }),
      snippet: z.object({
        title: z.string(),
        description: z.string().optional(),
        publishedAt: z.iso.datetime(),
        channelId: z.string().optional(),
        channelTitle: z.string().optional(),
      }),
    }),
  ),
});

const youtubeVideosSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().min(1),
      snippet: z.object({
        title: z.string(),
        description: z.string().optional(),
        publishedAt: z.iso.datetime(),
        channelId: z.string().optional(),
        channelTitle: z.string().optional(),
      }),
      statistics: z
        .object({
          viewCount: z.string().regex(/^\d+$/u).optional(),
          likeCount: z.string().regex(/^\d+$/u).optional(),
          commentCount: z.string().regex(/^\d+$/u).optional(),
        })
        .optional(),
      contentDetails: z.object({ duration: z.string().optional() }).optional(),
    }),
  ),
});

const integerMetric = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

const youtubeUrl = (path: string, parameters: Record<string, string>): URL => {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [name, value] of Object.entries(parameters)) {
    url.searchParams.set(name, value);
  }
  return url;
};

const durationSeconds = (duration: string | undefined): number | undefined => {
  if (!duration) return undefined;
  const match = duration.match(
    /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/u,
  );
  if (!match) return undefined;
  return (
    Number(match[1] ?? 0) * 86_400 +
    Number(match[2] ?? 0) * 3_600 +
    Number(match[3] ?? 0) * 60 +
    Number(match[4] ?? 0)
  );
};

export class YouTubeTrendSource implements TrendSource {
  public readonly id = 'YOUTUBE' as const;
  public readonly name = 'YouTube Data API v3';
  public readonly enabled: boolean;
  readonly #cache = new Map<string, { expiresAt: number; value: unknown }>();

  public constructor(
    private readonly options: {
      apiKey?: string;
      fetch?: Fetch;
      timeoutMs?: number;
      cacheTtlMs?: number;
      maxSearchesPerRun?: number;
    },
  ) {
    this.enabled = Boolean(options.apiKey);
  }

  async #json(url: URL, schema: z.ZodType): Promise<unknown> {
    const key = url.toString();
    const cached = this.#cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const response = await retryTransient(
      async () => {
        const result = await (this.options.fetch ?? fetch)(url, {
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 20_000),
        });
        if (!result.ok) {
          throw new Error(`YouTube API returned HTTP ${result.status}`);
        }
        return result;
      },
      { attempts: 2 },
    );
    const value = schema.parse(await response.json());
    this.#cache.set(key, {
      expiresAt: Date.now() + (this.options.cacheTtlMs ?? 6 * 60 * 60_000),
      value,
    });
    return value;
  }

  public async collect(
    context: TrendSourceContext,
  ): Promise<TrendSourceResult> {
    if (!this.options.apiKey) {
      return {
        source: this.id,
        availability: 'CREDENTIALS_REQUIRED',
        signals: [],
        quotaUsed: 0,
        error: 'SOCIALS_YOUTUBE_API_KEY is not configured',
      };
    }
    const regions = context.regions.filter(
      (region): region is 'US' | 'CZ' => region === 'US' || region === 'CZ',
    );
    const maxSearches = Math.max(0, this.options.maxSearchesPerRun ?? 8);
    if (maxSearches === 0) {
      return {
        source: this.id,
        availability: 'QUOTA_EXHAUSTED',
        signals: [],
        quotaUsed: 0,
        error: 'Configured YouTube search quota for this run is exhausted',
      };
    }
    const searches = regions
      .flatMap((region) =>
        context.keywords.map((keyword) => ({ region, keyword })),
      )
      .slice(0, maxSearches);
    if (!searches.length) {
      return {
        source: this.id,
        availability: 'ACTIVE',
        signals: [],
        quotaUsed: 0,
      };
    }
    const publishedAfter = new Date(
      context.now.getTime() - 7 * 24 * 60 * 60_000,
    ).toISOString();
    const searchResults = await Promise.allSettled(
      searches.map(async ({ region, keyword }) => {
        const value = youtubeSearchSchema.parse(
          await this.#json(
            youtubeUrl('search', {
              part: 'snippet',
              type: 'video',
              order: 'date',
              maxResults: '10',
              regionCode: region,
              relevanceLanguage: region === 'CZ' ? 'cs' : 'en',
              publishedAfter,
              q: keyword,
              key: this.options.apiKey!,
            }),
            youtubeSearchSchema,
          ),
        );
        return { region, keyword, items: value.items };
      }),
    );
    const discovered = searchResults.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    const ids = [
      ...new Set(
        discovered.flatMap(({ items }) => items.map(({ id }) => id.videoId)),
      ),
    ];
    if (!ids.length) {
      const firstError = searchResults.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      return {
        source: this.id,
        availability: firstError ? 'ERROR' : 'ACTIVE',
        signals: [],
        quotaUsed: searches.length,
        ...(firstError
          ? {
              error:
                firstError.reason instanceof Error
                  ? firstError.reason.message
                  : String(firstError.reason),
            }
          : {}),
      };
    }
    const videos = youtubeVideosSchema.parse(
      await this.#json(
        youtubeUrl('videos', {
          part: 'snippet,statistics,contentDetails',
          id: ids.join(','),
          key: this.options.apiKey,
        }),
        youtubeVideosSchema,
      ),
    );
    const videoById = new Map(videos.items.map((video) => [video.id, video]));
    const signals = discovered.flatMap((discovery) =>
      discovery.items.flatMap((item): TrendSignal[] => {
        const video = videoById.get(item.id.videoId);
        if (!video) return [];
        const seconds = durationSeconds(video.contentDetails?.duration);
        return [
          trendSignalSchema.parse({
            externalId: `${discovery.region}:${video.id}`,
            source: this.id,
            sourceUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`,
            title: video.snippet.title,
            ...(safeExternalExcerpt(video.snippet.description)
              ? { description: safeExternalExcerpt(video.snippet.description) }
              : {}),
            region: discovery.region,
            publishedAt: new Date(video.snippet.publishedAt),
            collectedAt: context.now,
            metrics: {
              ...(integerMetric(video.statistics?.viewCount) === undefined
                ? {}
                : { views: integerMetric(video.statistics?.viewCount) }),
              ...(integerMetric(video.statistics?.likeCount) === undefined
                ? {}
                : { likes: integerMetric(video.statistics?.likeCount) }),
              ...(integerMetric(video.statistics?.commentCount) === undefined
                ? {}
                : { comments: integerMetric(video.statistics?.commentCount) }),
            },
            metadata: {
              keyword: discovery.keyword,
              channelId: video.snippet.channelId,
              channelTitle: video.snippet.channelTitle,
              durationSeconds: seconds,
              shortFormCandidate: seconds !== undefined && seconds <= 60,
              regionMeaning:
                'YouTube regionCode affects discovery results; it is not verified viewer geography.',
            },
          }),
        ];
      }),
    );
    return {
      source: this.id,
      availability: 'ACTIVE',
      signals,
      quotaUsed: searches.length + 1,
      ...(searchResults.some((result) => result.status === 'rejected')
        ? {
            error:
              'Some keyword searches failed; successful searches were retained.',
          }
        : {}),
    };
  }
}

const redditTokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

const redditListingSchema = z.object({
  data: z.object({
    children: z.array(
      z.object({
        data: z.object({
          id: z.string().min(1),
          title: z.string().min(1),
          selftext: z.string().optional(),
          permalink: z.string().startsWith('/'),
          created_utc: z.number().nonnegative(),
          score: z.number().int(),
          num_comments: z.number().int().nonnegative(),
          subreddit: z.string().min(1),
          url: z.string().optional(),
        }),
      }),
    ),
  }),
});

export class RedditTrendSource implements TrendSource {
  public readonly id = 'REDDIT' as const;
  public readonly name = 'Reddit Data API';
  public readonly enabled: boolean;
  #token: { value: string; expiresAt: number } | undefined;

  public constructor(
    private readonly options: {
      clientId?: string;
      clientSecret?: string;
      userAgent?: string;
      fetch?: Fetch;
      timeoutMs?: number;
      maxCommunitiesPerRun?: number;
    },
  ) {
    this.enabled = Boolean(
      options.clientId && options.clientSecret && options.userAgent,
    );
  }

  async #accessToken(): Promise<string> {
    if (this.#token && this.#token.expiresAt > Date.now() + 60_000) {
      return this.#token.value;
    }
    const credentials = Buffer.from(
      `${this.options.clientId}:${this.options.clientSecret}`,
    ).toString('base64');
    const response = await (this.options.fetch ?? fetch)(
      'https://www.reddit.com/api/v1/access_token',
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${credentials}`,
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': this.options.userAgent!,
        },
        body: 'grant_type=client_credentials',
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 20_000),
      },
    );
    if (!response.ok)
      throw new Error(`Reddit OAuth returned HTTP ${response.status}`);
    const token = redditTokenSchema.parse(await response.json());
    this.#token = {
      value: token.access_token,
      expiresAt: Date.now() + token.expires_in * 1_000,
    };
    return token.access_token;
  }

  public async collect(
    context: TrendSourceContext,
  ): Promise<TrendSourceResult> {
    if (!this.enabled) {
      return {
        source: this.id,
        availability: 'CREDENTIALS_REQUIRED',
        signals: [],
        quotaUsed: 0,
        error:
          'Reddit requires SOCIALS_REDDIT_CLIENT_ID, SOCIALS_REDDIT_CLIENT_SECRET, and SOCIALS_REDDIT_USER_AGENT',
      };
    }
    const token = await this.#accessToken();
    const communities = context.subreddits.slice(
      0,
      this.options.maxCommunitiesPerRun ?? 12,
    );
    const settled = await Promise.allSettled(
      communities.map(async (community) => {
        if (!/^[A-Za-z0-9_]{2,50}$/u.test(community)) {
          throw new Error(`Invalid subreddit name: ${community}`);
        }
        const url = new URL(`https://oauth.reddit.com/r/${community}/hot`);
        url.searchParams.set('limit', '25');
        url.searchParams.set('raw_json', '1');
        const response = await (this.options.fetch ?? fetch)(url, {
          headers: {
            authorization: `Bearer ${token}`,
            'user-agent': this.options.userAgent!,
          },
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 20_000),
        });
        if (!response.ok) {
          throw new Error(
            `Reddit API returned HTTP ${response.status} for r/${community}`,
          );
        }
        return redditListingSchema.parse(await response.json());
      }),
    );
    const signals = settled.flatMap((result) =>
      result.status === 'fulfilled'
        ? result.value.data.children.map(({ data }): TrendSignal =>
            trendSignalSchema.parse({
              externalId: data.id,
              source: this.id,
              sourceUrl: new URL(
                data.permalink,
                'https://www.reddit.com',
              ).toString(),
              title: data.title,
              ...(safeExternalExcerpt(data.selftext)
                ? { description: safeExternalExcerpt(data.selftext) }
                : {}),
              region: 'US',
              publishedAt: new Date(data.created_utc * 1_000),
              collectedAt: context.now,
              metrics: {
                likes: Math.max(0, data.score),
                comments: data.num_comments,
              },
              metadata: {
                community: data.subreddit,
                outboundUrl: data.url,
                geographicCaveat:
                  'US is a configured source-market proxy; Reddit does not prove audience geography.',
              },
            }),
          )
        : [],
    );
    const failures = settled.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    return {
      source: this.id,
      availability:
        failures.length === settled.length && settled.length > 0
          ? 'ERROR'
          : 'ACTIVE',
      signals,
      quotaUsed: communities.length + 1,
      ...(failures.length
        ? {
            error: `${failures.length}/${settled.length} Reddit communities failed; successful results were retained.`,
          }
        : {}),
    };
  }
}

export class UnavailableTrendSource implements TrendSource {
  public readonly enabled = false;
  public constructor(
    public readonly id: Exclude<TrendSourceId, 'REDDIT' | 'YOUTUBE' | 'MANUAL'>,
    public readonly name: string,
    private readonly reason: string,
  ) {}

  public collect(): Promise<TrendSourceResult> {
    return Promise.resolve({
      source: this.id,
      availability: 'UNAVAILABLE',
      signals: [],
      quotaUsed: 0,
      error: this.reason,
    });
  }
}
