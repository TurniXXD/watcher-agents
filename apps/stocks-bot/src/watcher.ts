import {
  WatcherPipeline,
  WatcherRunner,
  type Analyzer,
  type PipelineResult,
  type Source,
  type SourceRequest,
  type WatchItem,
} from '@watcher/core';
import { StockSourceType, type WatcherStore } from '@watcher/database';
import {
  RssStockSource,
  SecEdgarSource,
  StooqPriceSource,
} from '@watcher/stock-sources';
import { renderStockDigest, sendSplitMessage } from '@watcher/telegram';
import type { Api } from 'grammy';

const configRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const missingSource = (id: string, reason: string): Source => ({
  id,
  fetch: async (): Promise<WatchItem[]> => Promise.reject(new Error(reason)),
});

export const createStocksRunner = (
  store: WatcherStore,
  analyzer: Analyzer,
  api: Api,
  secUserAgent: string,
  maxItemsPerRun: number,
): WatcherRunner => {
  const sec = new SecEdgarSource(secUserAgent);
  const price = new StooqPriceSource();
  const ir = new RssStockSource('INVESTOR_RELATIONS');
  const news = new RssStockSource('NEWS');
  const leasedAnalyzer: Analyzer = {
    analyze: (kind, item, signal) =>
      store.withOllamaLease(() => analyzer.analyze(kind, item, signal)),
  };
  const pipeline = new WatcherPipeline(store, leasedAnalyzer, maxItemsPerRun);

  const requestsForChat = async (chatId: bigint): Promise<SourceRequest[]> => {
    const chat = await store.getChat('STOCKS', chatId);
    if (!chat) return [];
    const stocks = await store.listStocks(chat.id);
    return stocks.flatMap((stock) =>
      stock.sources
        .filter((entry) => entry.enabled)
        .map((entry): SourceRequest => {
          const config = configRecord(entry.config);
          if (entry.source === StockSourceType.SEC) {
            return {
              source: sec,
              target: stock.symbol,
              config: { symbol: stock.symbol, cik: stock.cik ?? undefined },
            };
          }
          if (entry.source === StockSourceType.PRICE) {
            return {
              source: price,
              target: stock.symbol,
              config: { symbol: stock.symbol },
            };
          }
          const feedUrl =
            typeof config.feedUrl === 'string' ? config.feedUrl : undefined;
          const source =
            entry.source === StockSourceType.INVESTOR_RELATIONS ? ir : news;
          return feedUrl
            ? {
                source,
                target: stock.symbol,
                config: { symbol: stock.symbol, feedUrl },
              }
            : {
                source: missingSource(
                  entry.source,
                  `${entry.source} feed URL is not configured`,
                ),
                target: stock.symbol,
                config: {},
              };
        }),
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
    await sendSplitMessage(api, chatId, renderStockDigest(result));
  };
  return new WatcherRunner('STOCKS', pipeline, store, requestsForChat, notify);
};
