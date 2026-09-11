import {
  WatcherPipeline,
  WatcherRunner,
  type Analyzer,
  type PipelineResult,
  type SourceRequest,
  type WatcherLogger,
} from '@watcher/core';
import type {
  NewsConfigurationStore,
  NewsFeedRecord,
  NewsTopicRecord,
  WatcherStore,
} from '@watcher/database';
import {
  builtInNewsSources,
  builtInNewsSourceUrl,
  GdeltNewsSource,
  getBuiltInNewsSource,
  RssNewsSource,
} from '@watcher/sources/news';
import { sendSplitMessage } from '@watcher/telegram';
import type { Api } from 'grammy';
import type { AgentTelemetryRecorder } from '@watcher/observability';
import { renderNewsDigest } from './digest.js';

export const buildNewsSourceRequests = (
  feeds: readonly NewsFeedRecord[],
  topics: readonly NewsTopicRecord[],
  rssSource: RssNewsSource,
  gdeltSource: GdeltNewsSource,
  logger?: WatcherLogger,
): SourceRequest[] => {
  const enabledFeeds = feeds.filter(({ enabled }) => enabled);
  const sourceForFeed = (builtInKey: string | null) =>
    builtInKey ? getBuiltInNewsSource(builtInKey) : undefined;
  const unknownBuiltIns = enabledFeeds.filter(
    (feed) => feed.builtInKey && !sourceForFeed(feed.builtInKey),
  );
  for (const feed of unknownBuiltIns) {
    logger?.warn(
      { newsFeedId: feed.id, builtInKey: feed.builtInKey },
      'Skipping unknown built-in news source',
    );
  }
  const validFeeds = enabledFeeds.filter(
    (feed) => !feed.builtInKey || sourceForFeed(feed.builtInKey),
  );
  const topicsFor = (scope: 'CZECH' | 'GLOBAL') =>
    topics.filter((topic) => topic.scope === scope).map(({ topic }) => topic);
  const rssRequests = validFeeds.flatMap((feed): SourceRequest[] => {
    const builtIn = sourceForFeed(feed.builtInKey);
    if (builtIn?.adapter === 'GDELT') return [];
    return [
      {
        source: rssSource,
        target: `${feed.scope}:${feed.builtInKey ?? feed.url}`,
        targetKey: feed.scope,
        config: {
          feedUrl: builtIn?.feedUrl ?? feed.url,
          feedName: feed.name,
          ...(feed.builtInKey ? { sourceKey: feed.builtInKey } : {}),
          scope: feed.scope,
          topics: topicsFor(feed.scope),
        },
      },
    ];
  });
  const gdeltSources = validFeeds.flatMap((feed) => {
    const source = sourceForFeed(feed.builtInKey);
    return source?.adapter === 'GDELT' ? [source] : [];
  });
  if (gdeltSources.length === 0) return rssRequests;
  const publisherEntries = gdeltSources.flatMap((source) => {
    const domain = source.query.match(/^domain:([^\s]+)$/u)?.[1];
    return domain
      ? [[domain, { sourceKey: source.key, sourceName: source.name }] as const]
      : [];
  });
  const sourceKeys = gdeltSources.map(({ key }) => key);
  const gdeltTerms = gdeltSources.flatMap(({ query }) => {
    const trimmed = query.trim();
    const unwrapped = trimmed.match(/^\(([^()]*)\)$/u)?.[1] ?? trimmed;
    return unwrapped
      .split(/\s+OR\s+/iu)
      .map((term) => term.trim())
      .filter(Boolean);
  });
  return [
    ...rssRequests,
    {
      source: gdeltSource,
      target: 'GLOBAL:built-in-gdelt',
      targetKey: 'GLOBAL',
      config: {
        query: `(${gdeltTerms.join(' OR ')}) sourcelang:english`,
        sourceName: 'GDELT',
        scope: 'GLOBAL',
        topics: topicsFor('GLOBAL'),
        publishers: Object.fromEntries(publisherEntries),
        metadata: { sourceKeys },
        maxItems: 25,
      },
    },
  ];
};

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
  telemetry?: AgentTelemetryRecorder,
): WatcherRunner => {
  const rssSource = new RssNewsSource();
  const gdeltSource = new GdeltNewsSource();
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
  const requestsForChat = async (chatId: bigint): Promise<SourceRequest[]> => {
    const chat = await store.getChat('NEWS', chatId);
    if (!chat) return [];
    await newsConfiguration.syncBuiltInFeeds(
      chat.id,
      builtInNewsSources.map((source) => ({
        key: source.key,
        scope: source.scope,
        name: source.name,
        url: builtInNewsSourceUrl(source),
      })),
    );
    const [feeds, topics] = await Promise.all([
      newsConfiguration.listFeeds(chat.id),
      newsConfiguration.listTopics(chat.id),
    ]);
    return buildNewsSourceRequests(
      feeds,
      topics,
      rssSource,
      gdeltSource,
      logger,
    );
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
    telemetry,
  );
};
