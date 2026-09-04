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
  EarningsWhispersSource,
  FinvizInsiderSource,
  RssStockSource,
  StooqPriceSource,
  ZacksSource,
} from '@watcher/stock-sources';
import type { SecEdgarSource } from '@watcher/stock-sources';
import {
  formatRunDuration,
  renderStockDigest,
  sendSplitMessage,
} from '@watcher/telegram';
import type { Api } from 'grammy';

const configRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const missingSource = (id: string, reason: string): Source => ({
  id,
  fetch: async (): Promise<WatchItem[]> => Promise.reject(new Error(reason)),
});

const stockDisplayName = (stock: {
  symbol: string;
  companyName: string | null;
}): string =>
  stock.companyName ? `${stock.symbol} — ${stock.companyName}` : stock.symbol;

type StockEntry = Awaited<ReturnType<WatcherStore['listStocks']>>[number];

export const createStocksRunner = (
  store: WatcherStore,
  analyzer: Analyzer,
  api: Api,
  sec: SecEdgarSource,
  maxItemsPerRun: number,
): WatcherRunner => {
  const price = new StooqPriceSource();
  const finviz = new FinvizInsiderSource();
  const zacks = new ZacksSource();
  const earningsWhispers = new EarningsWhispersSource();
  const ir = new RssStockSource('INVESTOR_RELATIONS');
  const news = new RssStockSource('NEWS');
  const leasedAnalyzer: Analyzer = {
    analyze: (kind, item, signal) =>
      store.withOllamaLease(() => analyzer.analyze(kind, item, signal)),
  };
  const pipeline = new WatcherPipeline(store, leasedAnalyzer, maxItemsPerRun);
  const withCompany = async (stock: StockEntry): Promise<StockEntry> => {
    if (stock.companyName && stock.cik) return stock;
    try {
      const company = await sec.lookupCompany(stock.symbol);
      return store.updateStockCompany(stock.id, {
        companyName: company.companyName,
        cik: company.cik,
      });
    } catch {
      return stock;
    }
  };

  const requestsForChat = async (chatId: bigint): Promise<SourceRequest[]> => {
    const chat = await store.getChat('STOCKS', chatId);
    if (!chat) return [];
    const stocks = await Promise.all(
      (await store.listStocks(chat.id)).map(withCompany),
    );
    return stocks.flatMap((stock) =>
      stock.sources
        .filter((entry) => entry.enabled)
        .map((entry): SourceRequest => {
          const config = configRecord(entry.config);
          const target = stockDisplayName(stock);
          if (entry.source === StockSourceType.SEC) {
            return {
              source: sec,
              target,
              config: { symbol: stock.symbol, cik: stock.cik ?? undefined },
            };
          }
          if (entry.source === StockSourceType.PRICE) {
            return {
              source: price,
              target,
              config: { symbol: stock.symbol },
            };
          }
          if (entry.source === StockSourceType.FINVIZ) {
            return {
              source: finviz,
              target,
              config: { symbol: stock.symbol },
            };
          }
          if (entry.source === StockSourceType.ZACKS) {
            return {
              source: zacks,
              target,
              config: { symbol: stock.symbol },
            };
          }
          if (entry.source === StockSourceType.EARNINGS_WHISPERS) {
            return {
              source: earningsWhispers,
              target,
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
                target,
                config: { symbol: stock.symbol, feedUrl },
              }
            : {
                source: missingSource(
                  entry.source,
                  `${entry.source} feed URL is not configured`,
                ),
                target,
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
        await api.sendMessage(
          chatId.toString(),
          `Nothing new found.\nDuration: ${formatRunDuration(result.durationMs ?? 0)}`,
        );
      return;
    }
    await sendSplitMessage(api, chatId, renderStockDigest(result));
  };
  return new WatcherRunner('STOCKS', pipeline, store, requestsForChat, notify);
};
