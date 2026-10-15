import { SourceHttpError } from '@watcher/core';
import { z } from 'zod';
import { fetchTrendJson, type TrendHttpOptions } from './http.js';
import {
  canonicalTrendUrl,
  safeExternalExcerpt,
  trendSignalSchema,
  type TrendSignal,
  type TrendSource,
  type TrendSourceContext,
  type TrendSourceResult,
} from './types.js';

export const mastodonTrendTypeSchema = z.enum(['tags', 'statuses', 'links']);
export type MastodonTrendType = z.infer<typeof mastodonTrendTypeSchema>;

const historySchema = z.object({
  day: z.string(),
  uses: z.string().regex(/^\d+$/u),
  accounts: z.string().regex(/^\d+$/u),
});

const tagSchema = z.object({
  name: z.string().min(1),
  url: z.url(),
  history: z.array(historySchema).default([]),
});

const statusSchema = z.object({
  id: z.string().min(1),
  created_at: z.iso.datetime(),
  content: z.string(),
  url: z.url().nullable().optional(),
  uri: z.url(),
  replies_count: z.number().int().nonnegative().default(0),
  reblogs_count: z.number().int().nonnegative().default(0),
  favourites_count: z.number().int().nonnegative().default(0),
  account: z.object({
    acct: z.string().min(1),
    display_name: z.string().optional(),
    url: z.url(),
  }),
  tags: z
    .array(z.object({ name: z.string().min(1), url: z.url().optional() }))
    .default([]),
});

const linkSchema = z.object({
  url: z.url(),
  title: z.string().min(1),
  description: z.string().optional(),
  author_name: z.string().optional(),
  author_url: z.url().optional(),
  provider_name: z.string().optional(),
  history: z.array(historySchema).default([]),
});

const uses = (history: z.infer<typeof historySchema>[]): number | undefined => {
  const value = Number(history[0]?.uses);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
};

const mergeInstances = (
  current: TrendSignal | undefined,
  candidate: TrendSignal,
  instance: string,
): TrendSignal => {
  if (!current) {
    return {
      ...candidate,
      metadata: { ...candidate.metadata, seenOnInstances: [instance] },
    };
  }
  return {
    ...current,
    metadata: {
      ...current.metadata,
      seenOnInstances: [
        ...new Set([
          ...((current.metadata?.seenOnInstances as string[] | undefined) ??
            []),
          instance,
        ]),
      ],
    },
  };
};

export class MastodonTrendSource implements TrendSource {
  public readonly id = 'MASTODON' as const;
  public readonly name = 'Mastodon public trends';
  public readonly enabled: boolean;

  public constructor(
    private readonly options: TrendHttpOptions & {
      instances?: readonly string[];
      trendTypes?: readonly MastodonTrendType[];
      maxItems?: number;
    } = {},
  ) {
    this.enabled =
      (options.instances ?? ['https://mastodon.social']).length > 0 &&
      (options.trendTypes ?? ['tags', 'statuses', 'links']).length > 0;
  }

  public async collect(
    context: TrendSourceContext,
  ): Promise<TrendSourceResult> {
    const instances = this.options.instances ?? ['https://mastodon.social'];
    const trendTypes = this.options.trendTypes ?? ['tags', 'statuses', 'links'];
    if (!this.enabled) {
      return {
        source: this.id,
        availability: 'DISABLED',
        signals: [],
        quotaUsed: 0,
      };
    }
    const maxItems = Math.max(1, Math.min(this.options.maxItems ?? 50, 100));
    const requests = instances.flatMap((instance) =>
      trendTypes.map((trendType) => ({ instance, trendType })),
    );
    const settled = await Promise.allSettled(
      requests.map(async ({ instance, trendType }) => {
        const url = new URL(`/api/v1/trends/${trendType}`, instance);
        url.searchParams.set('limit', String(maxItems));
        const hostname = new URL(instance).hostname;
        const init = { headers: { accept: 'application/json' } };
        if (trendType === 'tags') {
          return {
            instance: hostname,
            trendType,
            items: await fetchTrendJson(
              url,
              z.array(tagSchema),
              this.options,
              init,
            ),
          } as const;
        }
        if (trendType === 'statuses') {
          return {
            instance: hostname,
            trendType,
            items: await fetchTrendJson(
              url,
              z.array(statusSchema),
              this.options,
              init,
            ),
          } as const;
        }
        return {
          instance: hostname,
          trendType,
          items: await fetchTrendJson(
            url,
            z.array(linkSchema),
            this.options,
            init,
          ),
        } as const;
      }),
    );
    const signals = new Map<string, TrendSignal>();
    for (const result of settled) {
      if (result.status !== 'fulfilled') {
        continue;
      }
      const { instance, trendType, items } = result.value;
      if (trendType === 'tags') {
        for (const tag of items) {
          const key = `tag:${tag.name.toLowerCase()}`;
          const signal = trendSignalSchema.parse({
            externalId: key,
            source: this.id,
            sourceUrl: tag.url,
            title: `#${tag.name}`,
            author: instance,
            keywords: [tag.name],
            region: 'GLOBAL',
            collectedAt: context.now,
            metrics: {
              ...(uses(tag.history) === undefined
                ? {}
                : { searchInterest: uses(tag.history) }),
            },
            metadata: { trendType, history: tag.history },
          });
          signals.set(key, mergeInstances(signals.get(key), signal, instance));
        }
        continue;
      }
      if (trendType === 'statuses') {
        for (const status of items) {
          const description = safeExternalExcerpt(status.content);
          if (!description) {
            continue;
          }
          const url = status.url ?? status.uri;
          const key = `status:${canonicalTrendUrl(url)}`;
          const signal = trendSignalSchema.parse({
            externalId: status.id,
            source: this.id,
            sourceUrl: url,
            title: description.slice(0, 500),
            description,
            author: status.account.display_name || status.account.acct,
            keywords: status.tags.map(({ name }) => name),
            region: 'GLOBAL',
            publishedAt: new Date(status.created_at),
            collectedAt: context.now,
            metrics: {
              likes: status.favourites_count,
              comments: status.replies_count,
              shares: status.reblogs_count,
            },
            metadata: {
              trendType,
              account: status.account.acct,
              accountUrl: status.account.url,
            },
          });
          signals.set(key, mergeInstances(signals.get(key), signal, instance));
        }
        continue;
      }
      for (const link of items) {
        const title = safeExternalExcerpt(link.title);
        if (!title) {
          continue;
        }
        const key = `link:${canonicalTrendUrl(link.url)}`;
        const signal = trendSignalSchema.parse({
          externalId: key,
          source: this.id,
          sourceUrl: link.url,
          title,
          ...(safeExternalExcerpt(link.description)
            ? { description: safeExternalExcerpt(link.description) }
            : {}),
          author: link.author_name || link.provider_name || instance,
          keywords: [],
          region: 'GLOBAL',
          collectedAt: context.now,
          metrics: {
            ...(uses(link.history) === undefined
              ? {}
              : { searchInterest: uses(link.history) }),
          },
          metadata: {
            trendType,
            authorUrl: link.author_url,
            history: link.history,
          },
        });
        signals.set(key, mergeInstances(signals.get(key), signal, instance));
      }
    }
    const failures = settled.filter((result) => result.status === 'rejected');
    const restricted = failures.filter(
      ({ reason }) =>
        reason instanceof SourceHttpError &&
        (reason.status === 401 || reason.status === 403),
    ).length;
    const availability =
      failures.length === settled.length
        ? restricted === failures.length
          ? 'UNAVAILABLE'
          : 'ERROR'
        : 'ACTIVE';
    return {
      source: this.id,
      availability,
      signals: [...signals.values()].slice(0, maxItems),
      quotaUsed: settled.length - failures.length,
      ...(failures.length > 0
        ? {
            error: `${failures.length}/${settled.length} Mastodon trend endpoints failed (${restricted} authentication-restricted); successful instances were retained.`,
          }
        : {}),
    };
  }
}
