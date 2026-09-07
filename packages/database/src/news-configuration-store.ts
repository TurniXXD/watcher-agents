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
  scope: NewsScopeId;
  name: string;
  url: string;
  enabled: boolean;
};

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
    const feed = await this.db.newsFeed.upsert({
      where: { chatConfigId_scope_url: { chatConfigId, scope, url } },
      create: { chatConfigId, scope: NewsScope[scope], url, name },
      update: { name, enabled: true },
    });
    this.logger?.info(
      { newsFeedId: feed.id, scope: feed.scope },
      'News feed configured',
    );
    return { ...feed, scope: feed.scope };
  }

  public listFeeds(chatConfigId: string): Promise<NewsFeedRecord[]> {
    return this.db.newsFeed.findMany({
      where: { chatConfigId },
      orderBy: [{ scope: 'asc' }, { name: 'asc' }],
      select: { id: true, scope: true, name: true, url: true, enabled: true },
    });
  }

  public async removeFeed(chatConfigId: string, id: string): Promise<boolean> {
    const result = await this.db.newsFeed.deleteMany({
      where: { id, chatConfigId },
    });
    return result.count > 0;
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
