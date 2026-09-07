import {
  WatcherPipeline,
  WatcherRunner,
  type Analyzer,
  type PipelineResult,
  type SourceRequest,
  type WatcherLogger,
} from '@watcher/core';
import type { NewsConfigurationStore, WatcherStore } from '@watcher/database';
import { sendSplitMessage } from '@watcher/telegram';
import type { Api } from 'grammy';
import { renderNewsDigest } from './digest.js';
import { RssNewsSource, type NewsFeedConfig } from './sources/index.js';

export const createNewsRunner = (
  store: WatcherStore,
  newsConfiguration: NewsConfigurationStore,
  analyzer: Analyzer,
  api: Api,
  maxItemsPerRun: number,
  logger?: WatcherLogger,
  afterRun?: (
    chatId: bigint,
    result: PipelineResult,
    runId: string,
  ) => Promise<void>,
  afterFailure?: (
    chatId: bigint,
    error: string,
    runId: string,
  ) => Promise<void>,
): WatcherRunner => {
  const source = new RssNewsSource();
  const leasedAnalyzer: Analyzer = {
    analyze: (kind, item, signal) =>
      store.withOllamaLease(() => analyzer.analyze(kind, item, signal)),
  };
  const pipeline = new WatcherPipeline(
    store,
    leasedAnalyzer,
    maxItemsPerRun,
    logger,
  );
  const requestsForChat = async (
    chatId: bigint,
  ): Promise<SourceRequest<NewsFeedConfig>[]> => {
    const chat = await store.getChat('NEWS', chatId);
    if (!chat) return [];
    const [feeds, topics] = await Promise.all([
      newsConfiguration.listFeeds(chat.id),
      newsConfiguration.listTopics(chat.id),
    ]);
    return feeds
      .filter(({ enabled }) => enabled)
      .map((feed) => ({
        source,
        target: `${feed.scope}:${feed.url}`,
        targetKey: feed.scope,
        config: {
          feedUrl: feed.url,
          feedName: feed.name,
          scope: feed.scope,
          topics: topics
            .filter(({ scope }) => scope === feed.scope)
            .map(({ topic }) => topic),
        },
      }));
  };
  const notify = async (
    chatId: bigint,
    result: PipelineResult,
    manual: boolean,
  ): Promise<void> => {
    if (result.newItemCount === 0 && result.sourceFailures.length === 0) {
      if (manual)
        await api.sendMessage(chatId.toString(), 'Nothing new found.');
      return;
    }
    await sendSplitMessage(api, chatId, renderNewsDigest(result));
  };
  return new WatcherRunner(
    'NEWS',
    pipeline,
    store,
    requestsForChat,
    notify,
    logger,
    afterRun,
    afterFailure,
  );
};
