import { assertPublicHttpUrl } from '@watcher/core';
import { z } from 'zod';
import {
  fetchTrendJson,
  mapWithConcurrency,
  type TrendHttpOptions,
} from './http.js';
import {
  safeExternalExcerpt,
  trendSignalSchema,
  type TrendSignal,
  type TrendSource,
  type TrendSourceContext,
  type TrendSourceResult,
} from './types.js';

export const hackerNewsCategorySchema = z.enum(['top', 'new', 'best']);
export type HackerNewsCategory = z.infer<typeof hackerNewsCategorySchema>;

const storyIdsSchema = z.array(z.number().int().positive());
const storySchema = z
  .object({
    id: z.number().int().positive(),
    deleted: z.boolean().optional(),
    type: z.string().optional(),
    by: z.string().optional(),
    time: z.number().int().nonnegative().optional(),
    text: z.string().optional(),
    dead: z.boolean().optional(),
    url: z.string().optional(),
    score: z.number().int().optional(),
    title: z.string().optional(),
    descendants: z.number().int().nonnegative().optional(),
  })
  .nullable();

type Story = NonNullable<z.infer<typeof storySchema>>;

const keywordMatches = (
  story: Story,
  keywords: readonly string[],
): string[] => {
  if (keywords.length === 0) {
    return [];
  }
  const text = `${story.title ?? ''} ${story.text ?? ''}`.toLowerCase();
  return keywords.filter((keyword) => text.includes(keyword.toLowerCase()));
};

const storyUrl = (story: Story, discussionUrl: string): string => {
  if (!story.url) {
    return discussionUrl;
  }
  try {
    return assertPublicHttpUrl(story.url).toString();
  } catch {
    return discussionUrl;
  }
};

export class HackerNewsTrendSource implements TrendSource {
  public readonly id = 'HACKERNEWS' as const;
  public readonly name = 'Hacker News Firebase API';
  public readonly enabled: boolean;
  readonly #cache = new Map<
    number,
    { expiresAt: number; story: Story | null }
  >();

  public constructor(
    private readonly options: TrendHttpOptions & {
      apiUrl?: string;
      categories?: readonly HackerNewsCategory[];
      maxStories?: number;
      concurrency?: number;
      cacheTtlMs?: number;
    } = {},
  ) {
    this.enabled = (options.categories ?? ['top', 'new', 'best']).length > 0;
  }

  async #story(id: number): Promise<Story | null> {
    const cached = this.#cache.get(id);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.story;
    }
    const story = await fetchTrendJson(
      new URL(
        `item/${id}.json`,
        `${this.options.apiUrl ?? 'https://hacker-news.firebaseio.com/v0'}/`,
      ),
      storySchema,
      this.options,
      { headers: { accept: 'application/json' } },
    );
    this.#cache.set(id, {
      expiresAt: Date.now() + (this.options.cacheTtlMs ?? 10 * 60_000),
      story,
    });
    return story;
  }

  public async collect(
    context: TrendSourceContext,
  ): Promise<TrendSourceResult> {
    const categories = this.options.categories ?? ['top', 'new', 'best'];
    if (!this.enabled) {
      return {
        source: this.id,
        availability: 'DISABLED',
        signals: [],
        quotaUsed: 0,
      };
    }
    const maxStories = Math.max(
      1,
      Math.min(this.options.maxStories ?? 100, 500),
    );
    const baseUrl = `${this.options.apiUrl ?? 'https://hacker-news.firebaseio.com/v0'}/`;
    const categoryResults = await Promise.allSettled(
      categories.map(async (category) => ({
        category,
        ids: await fetchTrendJson(
          new URL(`${category}stories.json`, baseUrl),
          storyIdsSchema,
          this.options,
          { headers: { accept: 'application/json' } },
        ),
      })),
    );
    const categoryById = new Map<number, Set<HackerNewsCategory>>();
    for (const result of categoryResults) {
      if (result.status !== 'fulfilled') {
        continue;
      }
      for (const id of result.value.ids.slice(0, maxStories)) {
        const existing = categoryById.get(id) ?? new Set<HackerNewsCategory>();
        existing.add(result.value.category);
        categoryById.set(id, existing);
        if (categoryById.size >= maxStories) {
          break;
        }
      }
      if (categoryById.size >= maxStories) {
        break;
      }
    }
    const ids = [...categoryById.keys()];
    const storyResults = await mapWithConcurrency(
      ids,
      this.options.concurrency ?? 8,
      async (id) => ({ id, story: await this.#story(id) }),
    );
    const signals: TrendSignal[] = [];
    for (const result of storyResults) {
      if (result.status !== 'fulfilled') {
        continue;
      }
      const { id, story } = result.value;
      if (
        !story ||
        story.deleted ||
        story.dead ||
        story.type !== 'story' ||
        !story.title ||
        !story.by ||
        story.time === undefined
      ) {
        continue;
      }
      const matchedKeywords = keywordMatches(story, context.keywords);
      if (context.keywords.length > 0 && matchedKeywords.length === 0) {
        continue;
      }
      const discussionUrl = `https://news.ycombinator.com/item?id=${id}`;
      signals.push(
        trendSignalSchema.parse({
          externalId: String(id),
          source: this.id,
          sourceUrl: storyUrl(story, discussionUrl),
          title: story.title,
          ...(safeExternalExcerpt(story.text)
            ? { description: safeExternalExcerpt(story.text) }
            : {}),
          author: story.by,
          keywords: matchedKeywords,
          region: 'GLOBAL',
          publishedAt: new Date(story.time * 1_000),
          collectedAt: context.now,
          metrics: {
            ...(story.score === undefined
              ? {}
              : { likes: Math.max(0, story.score) }),
            ...(story.descendants === undefined
              ? {}
              : { comments: story.descendants }),
          },
          metadata: {
            categories: [...(categoryById.get(id) ?? [])],
            discussionUrl,
            articleUrl: story.url,
          },
        }),
      );
    }
    const categoryFailures = categoryResults.filter(
      (result) => result.status === 'rejected',
    ).length;
    const storyFailures = storyResults.filter(
      (result) => result.status === 'rejected',
    ).length;
    const allCategoriesFailed = categoryFailures === categoryResults.length;
    return {
      source: this.id,
      availability: allCategoriesFailed ? 'ERROR' : 'ACTIVE',
      signals,
      quotaUsed: categoryResults.length + ids.length - storyFailures,
      ...(categoryFailures + storyFailures > 0
        ? {
            error: `${categoryFailures} category request(s) and ${storyFailures} story request(s) failed; successful results were retained.`,
          }
        : {}),
    };
  }
}
