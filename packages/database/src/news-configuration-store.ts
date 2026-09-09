import { assertPublicHttpUrl, type WatcherLogger } from '@watcher/core';
import { z } from 'zod';
import type { DatabaseClient } from './client.js';
import { NewsScope } from './generated/prisma/enums.js';

export const newsScopeSchema = z.enum(['CZECH', 'GLOBAL']);
export type NewsScopeId = z.infer<typeof newsScopeSchema>;

const feedNameSchema = z.string().trim().min(1).max(120);
const topicSchema = z.string().trim().min(1).max(200);
const feedUrlSchema = z.url().transform((value, context) => {
  try {
    return assertPublicHttpUrl(value).toString();
  } catch (error) {
    context.addIssue({
      code: 'custom',
      message: error instanceof Error ? error.message : 'Invalid feed URL',
    });
    return z.NEVER;
  }
});

export type NewsFeedRecord = {
  id: string;
  builtInKey: string | null;
  scope: NewsScopeId;
  name: string;
  url: string;
  enabled: boolean;
};

const builtInFeedSchema = z.object({
  key: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
    .max(100),
  scope: newsScopeSchema,
  name: feedNameSchema,
  url: feedUrlSchema,
});

export type BuiltInNewsFeed = z.input<typeof builtInFeedSchema>;

export type RemoveNewsFeedResult = 'REMOVED' | 'BUILT_IN' | 'NOT_FOUND';

export type NewsTopicRecord = {
  id: string;
  scope: NewsScopeId;
  topic: string;
};

export class NewsConfigurationStore {
  public constructor(
    private readonly db: DatabaseClient,
    private readonly logger?: WatcherLogger,
  ) {}

  public async addFeed(
    chatConfigId: string,
    rawScope: unknown,
    rawUrl: unknown,
    rawName: unknown,
  ): Promise<NewsFeedRecord> {
    const scope = newsScopeSchema.parse(rawScope);
    const url = feedUrlSchema.parse(rawUrl);
    const name = feedNameSchema.parse(rawName);
    const existing = await this.db.newsFeed.findUnique({
      where: { chatConfigId_scope_url: { chatConfigId, scope, url } },
    });
    if (existing?.builtInKey) {
      const enabled = await this.db.newsFeed.update({
        where: { id: existing.id },
        data: { enabled: true },
      });
      return {
        ...enabled,
        builtInKey: enabled.builtInKey,
        scope: enabled.scope,
      };
    }
    const feed = await this.db.newsFeed.upsert({
      where: { chatConfigId_scope_url: { chatConfigId, scope, url } },
      create: { chatConfigId, scope: NewsScope[scope], url, name },
      update: { name, enabled: true },
    });
    this.logger?.info(
      { newsFeedId: feed.id, scope: feed.scope },
      'News feed configured',
    );
    return { ...feed, builtInKey: feed.builtInKey, scope: feed.scope };
  }

  public async syncBuiltInFeeds(
    chatConfigId: string,
    rawFeeds: readonly BuiltInNewsFeed[],
  ): Promise<void> {
    const feeds = z.array(builtInFeedSchema).parse(rawFeeds);
    const existing = await this.db.newsFeed.findMany({
      where: { chatConfigId },
      select: {
        id: true,
        builtInKey: true,
        scope: true,
        name: true,
        url: true,
      },
    });
    const byKey = new Map(
      existing.flatMap((feed) =>
        feed.builtInKey ? [[feed.builtInKey, feed] as const] : [],
      ),
    );
    const unclaimedByScopeAndUrl = new Map(
      existing.flatMap((feed) =>
        feed.builtInKey ? [] : [[`${feed.scope}:${feed.url}`, feed] as const],
      ),
    );

    for (const feed of feeds) {
      const current =
        byKey.get(feed.key) ??
        unclaimedByScopeAndUrl.get(`${feed.scope}:${feed.url}`);
      if (!current) {
        await this.db.newsFeed.upsert({
          where: {
            chatConfigId_scope_url: {
              chatConfigId,
              scope: NewsScope[feed.scope],
              url: feed.url,
            },
          },
          create: {
            chatConfigId,
            builtInKey: feed.key,
            scope: NewsScope[feed.scope],
            name: feed.name,
            url: feed.url,
            enabled: true,
          },
          update: { builtInKey: feed.key, name: feed.name },
        });
        continue;
      }
      if (
        current.builtInKey !== feed.key ||
        current.scope !== feed.scope ||
        current.name !== feed.name ||
        current.url !== feed.url
      ) {
        await this.db.newsFeed.update({
          where: { id: current.id },
          data: {
            builtInKey: feed.key,
            scope: NewsScope[feed.scope],
            name: feed.name,
            url: feed.url,
          },
        });
      }
    }
  }

  public listFeeds(chatConfigId: string): Promise<NewsFeedRecord[]> {
    return this.db.newsFeed.findMany({
      where: { chatConfigId },
      orderBy: [{ scope: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        builtInKey: true,
        scope: true,
        name: true,
        url: true,
        enabled: true,
      },
    });
  }

  public async removeFeed(
    chatConfigId: string,
    id: string,
  ): Promise<RemoveNewsFeedResult> {
    const feed = await this.db.newsFeed.findFirst({
      where: { id, chatConfigId },
      select: { builtInKey: true },
    });
    if (!feed) return 'NOT_FOUND';
    if (feed.builtInKey) return 'BUILT_IN';
    const result = await this.db.newsFeed.deleteMany({
      where: { id, chatConfigId },
    });
    return result.count > 0 ? 'REMOVED' : 'NOT_FOUND';
  }

  public async setFeedEnabled(
    chatConfigId: string,
    id: string,
    enabled: boolean,
  ): Promise<boolean> {
    const result = await this.db.newsFeed.updateMany({
      where: { id, chatConfigId },
      data: { enabled },
    });
    return result.count > 0;
  }

  public async addTopic(
    chatConfigId: string,
    rawScope: unknown,
    rawTopic: unknown,
  ): Promise<NewsTopicRecord> {
    const scope = newsScopeSchema.parse(rawScope);
    const topic = topicSchema.parse(rawTopic);
    const normalizedTopic = topic.toLocaleLowerCase('en-US');
    const saved = await this.db.newsTopic.upsert({
      where: {
        chatConfigId_scope_normalizedTopic: {
          chatConfigId,
          scope,
          normalizedTopic,
        },
      },
      create: {
        chatConfigId,
        scope: NewsScope[scope],
        topic,
        normalizedTopic,
      },
      update: { topic },
    });
    return { id: saved.id, scope: saved.scope, topic: saved.topic };
  }

  public listTopics(chatConfigId: string): Promise<NewsTopicRecord[]> {
    return this.db.newsTopic.findMany({
      where: { chatConfigId },
      orderBy: [{ scope: 'asc' }, { topic: 'asc' }],
      select: { id: true, scope: true, topic: true },
    });
  }

  public async removeTopic(
    chatConfigId: string,
    rawScope: unknown,
    rawTopic: unknown,
  ): Promise<boolean> {
    const scope = newsScopeSchema.parse(rawScope);
    const topic = topicSchema.parse(rawTopic);
    const result = await this.db.newsTopic.deleteMany({
      where: {
        chatConfigId,
        scope: NewsScope[scope],
        normalizedTopic: topic.toLocaleLowerCase('en-US'),
      },
    });
    return result.count > 0;
  }
}
