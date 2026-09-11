import {
  WatcherPipeline,
  WatcherRunner,
  type Analyzer,
  type PipelineResult,
  type SourceRequest,
  type WatcherLogger,
} from '@watcher/core';
import { PublicationSourceType, type WatcherStore } from '@watcher/database';
import {
  BioRxivSource,
  ClinicalTrialsSource,
  FdaSource,
  PubMedSource,
} from './sources/index.js';
import {
  formatRunDuration,
  renderPublicationDigest,
  sendSplitMessage,
} from '@watcher/telegram';
import type { Api } from 'grammy';
import type { AgentTelemetryRecorder } from '@watcher/observability';
import { fairlyOrderPublicationItems } from './utils/fair-items.js';

export const createPublicationsRunner = (
  store: WatcherStore,
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
  const sources = {
    [PublicationSourceType.PUBMED]: new PubMedSource(),
    [PublicationSourceType.BIORXIV]: new BioRxivSource(),
    [PublicationSourceType.CLINICAL_TRIALS]: new ClinicalTrialsSource(),
    [PublicationSourceType.FDA]: new FdaSource(),
  };
  const leasedAnalyzer: Analyzer = {
    analyze: (kind, item, signal) =>
      store.withOllamaLease(() => analyzer.analyze(kind, item, signal)),
  };
  const pipeline = new WatcherPipeline(
    store,
    leasedAnalyzer,
    maxItemsPerRun,
    logger,
    fairlyOrderPublicationItems,
  );
  const requestsForChat = async (chatId: bigint): Promise<SourceRequest[]> => {
    const chat = await store.getChat('PUBLICATIONS', chatId);
    if (!chat) return [];
    const queries = await store.listQueries(chat.id);
    return queries.flatMap((query) =>
      query.sources
        .filter((entry) => entry.enabled)
        .map((entry) => ({
          source: sources[entry.source],
          target: query.query,
          config: { query: query.query },
        })),
    );
  };
  const notify = async (
    chatId: bigint,
    result: PipelineResult,
    manual: boolean,
  ): Promise<void> => {
    if (result.newItemCount === 0 && result.sourceFailures.length === 0) {
      if (manual)
        await api.sendMessage(
          chatId.toString(),
          `Nothing new found.\nDuration: ${formatRunDuration(result.durationMs ?? 0)}`,
        );
      return;
    }
    await sendSplitMessage(api, chatId, renderPublicationDigest(result));
  };
  return new WatcherRunner(
    'PUBLICATIONS',
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
