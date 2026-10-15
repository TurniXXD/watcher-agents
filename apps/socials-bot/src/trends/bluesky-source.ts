import { z } from 'zod';
import { fetchTrendJson, type TrendHttpOptions } from './http.js';
import {
  safeExternalExcerpt,
  trendSignalSchema,
  type TrendSignal,
  type TrendSource,
  type TrendSourceContext,
  type TrendSourceResult,
} from './types.js';

const blueskyPostSchema = z.object({
  uri: z.string().startsWith('at://'),
  author: z.object({
    did: z.string().min(1),
    handle: z.string().min(1),
    displayName: z.string().optional(),
  }),
  record: z
    .object({
      text: z.string().default(''),
      createdAt: z.iso.datetime().optional(),
      langs: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
    })
    .passthrough(),
  indexedAt: z.iso.datetime(),
  likeCount: z.number().int().nonnegative().optional(),
  repostCount: z.number().int().nonnegative().optional(),
  replyCount: z.number().int().nonnegative().optional(),
  quoteCount: z.number().int().nonnegative().optional(),
});

const blueskySearchSchema = z.object({
  cursor: z.string().optional(),
  posts: z.array(blueskyPostSchema),
});

const postUrl = (uri: string, handle: string): string => {
  const recordKey = uri.split('/').at(-1);
  if (!recordKey) {
    throw new Error('Bluesky post URI omitted its record key');
  }
  return `https://bsky.app/profile/${encodeURIComponent(handle)}/post/${encodeURIComponent(recordKey)}`;
};

export class BlueskyTrendSource implements TrendSource {
  public readonly id = 'BLUESKY' as const;
  public readonly name = 'Bluesky public AppView';
  public readonly enabled: boolean;

  public constructor(
    private readonly options: TrendHttpOptions & {
      apiUrl?: string;
      keywords?: readonly string[];
      maxPosts?: number;
      lookbackHours?: number;
    } = {},
  ) {
    this.enabled = Boolean(options.apiUrl ?? 'https://public.api.bsky.app');
  }

  public async collect(
    context: TrendSourceContext,
  ): Promise<TrendSourceResult> {
    const keywords = [
      ...new Set([...(this.options.keywords ?? []), ...context.keywords]),
    ]
      .map((keyword) => keyword.trim())
      .filter(Boolean);
    if (!this.enabled || keywords.length === 0) {
      return {
        source: this.id,
        availability: 'DISABLED',
        signals: [],
        quotaUsed: 0,
        error: 'No Bluesky search keywords are configured',
      };
    }
    const apiUrl = new URL(
      '/xrpc/app.bsky.feed.searchPosts',
      this.options.apiUrl ?? 'https://public.api.bsky.app',
    );
    const maxPosts = Math.max(1, Math.min(this.options.maxPosts ?? 50, 500));
    const perKeywordLimit = Math.max(
      1,
      Math.ceil(maxPosts / Math.max(1, keywords.length)),
    );
    const since = new Date(
      context.now.getTime() -
        Math.max(1, this.options.lookbackHours ?? 7 * 24) * 3_600_000,
    ).toISOString();
    const settled = await Promise.allSettled(
      keywords.map(async (keyword) => {
        const posts: z.infer<typeof blueskyPostSchema>[] = [];
        let cursor: string | undefined;
        let requests = 0;
        while (posts.length < perKeywordLimit && requests < 5) {
          const url = new URL(apiUrl);
          url.searchParams.set('q', keyword);
          url.searchParams.set('sort', 'latest');
          url.searchParams.set('since', since);
          url.searchParams.set(
            'limit',
            String(Math.min(100, perKeywordLimit - posts.length)),
          );
          if (cursor) {
            url.searchParams.set('cursor', cursor);
          }
          const page = await fetchTrendJson(
            url,
            blueskySearchSchema,
            this.options,
            { headers: { accept: 'application/json' } },
          );
          requests += 1;
          posts.push(...page.posts);
          if (!page.cursor || page.posts.length === 0) {
            break;
          }
          cursor = page.cursor;
        }
        return { keyword, posts, requests };
      }),
    );
    const successful = settled.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    const signals = new Map<string, TrendSignal>();
    for (const { keyword, posts } of successful) {
      for (const post of posts) {
        const description = safeExternalExcerpt(post.record.text);
        if (!description) {
          continue;
        }
        const publishedAt = new Date(post.record.createdAt ?? post.indexedAt);
        if (publishedAt.getTime() < new Date(since).getTime()) {
          continue;
        }
        const tags = post.record.tags ?? [];
        const signal = trendSignalSchema.parse({
          externalId: post.uri,
          source: this.id,
          sourceUrl: postUrl(post.uri, post.author.handle),
          title: description.slice(0, 500),
          description,
          author: post.author.displayName || post.author.handle,
          keywords: [...new Set([keyword, ...tags])],
          region: 'GLOBAL',
          publishedAt,
          collectedAt: context.now,
          metrics: {
            ...(post.likeCount === undefined ? {} : { likes: post.likeCount }),
            ...(post.replyCount === undefined
              ? {}
              : { comments: post.replyCount }),
            ...(post.repostCount === undefined
              ? {}
              : { shares: post.repostCount }),
          },
          metadata: {
            keyword,
            authorDid: post.author.did,
            authorHandle: post.author.handle,
            languages: post.record.langs ?? [],
            tags,
            quoteCount: post.quoteCount,
            repostCount: post.repostCount,
            indexedAt: post.indexedAt,
          },
        });
        signals.set(post.uri, signal);
      }
    }
    const failures = settled.length - successful.length;
    return {
      source: this.id,
      availability:
        successful.length === 0 && failures > 0 ? 'ERROR' : 'ACTIVE',
      signals: [...signals.values()].slice(0, maxPosts),
      quotaUsed: successful.reduce((sum, result) => sum + result.requests, 0),
      ...(failures > 0
        ? {
            error: `${failures}/${settled.length} Bluesky keyword searches failed; successful results were retained.`,
          }
        : {}),
    };
  }
}
