import {
  WatcherPipeline,
  WatcherRunner,
  type Analyzer,
  type PipelineResult,
  type SourceRequest,
  type WatcherLogger,
} from '@watcher/core';
import { StockSourceType, type WatcherStore } from '@watcher/database';
import {
  AlphaVantageInstitutionalSource,
  AlphaVantageOptionsSource,
  EarningsWhispersSource,
  FinraShortInterestSource,
  FinvizInsiderSource,
  GdeltNewsSource,
  InvestorRelationsSource,
  QuiverSource,
  StockClinicalTrialsSource,
  StockFdaSource,
  StooqPriceSource,
  TradingViewNewsSource,
  ZacksSource,
  type SecEdgarSource,
} from './sources/index.js';
import { renderStockDigest, sendSplitMessage } from '@watcher/telegram';
import type { Api } from 'grammy';
import type { AgentTelemetryRecorder } from '@watcher/observability';
import {
  hasReportableStockInformation,
  reportableStockResult,
} from './run-output.js';

const stockDisplayName = (stock: {
  symbol: string;
  companyName: string | null;
}): string =>
  stock.companyName ? `${stock.symbol} — ${stock.companyName}` : stock.symbol;

type StockEntry = Awaited<ReturnType<WatcherStore['listStocks']>>[number];

export type StocksAdvancedSourcesConfig = {
  alphaVantageApiKey: string | undefined;
  alphaVantageOptionsEnabled: boolean;
  quiverToken: string | undefined;
};

export const createStocksRunner = (
  store: WatcherStore,
  analyzer: Analyzer,
  api: Api,
  sec: SecEdgarSource,
  advancedSources: StocksAdvancedSourcesConfig,
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
  const price = new StooqPriceSource();
  const investorRelations = new InvestorRelationsSource();
  const news = new GdeltNewsSource();
  const tradingViewNews = new TradingViewNewsSource();
  const finviz = new FinvizInsiderSource();
  const zacks = new ZacksSource();
  const earningsWhispers = new EarningsWhispersSource();
  const shortInterest = new FinraShortInterestSource();
  const clinicalTrials = new StockClinicalTrialsSource();
  const fda = new StockFdaSource();
  const alphaInstitutional = advancedSources.alphaVantageApiKey
    ? new AlphaVantageInstitutionalSource(advancedSources.alphaVantageApiKey)
    : undefined;
  const alphaOptions =
    advancedSources.alphaVantageApiKey &&
    advancedSources.alphaVantageOptionsEnabled
      ? new AlphaVantageOptionsSource(advancedSources.alphaVantageApiKey)
      : undefined;
  const quiverSources: ReadonlyMap<StockSourceType, QuiverSource> =
    advancedSources.quiverToken
      ? new Map<StockSourceType, QuiverSource>(
          [
            StockSourceType.QUIVER_INSIDERS,
            StockSourceType.QUIVER_CONTRACTS,
            StockSourceType.QUIVER_PATENTS,
            StockSourceType.QUIVER_CONGRESS,
            StockSourceType.QUIVER_OFF_EXCHANGE,
            StockSourceType.QUIVER_LOBBYING,
          ].map((sourceType): [StockSourceType, QuiverSource] => [
            sourceType,
            new QuiverSource(sourceType, advancedSources.quiverToken!),
          ]),
        )
      : new Map<StockSourceType, QuiverSource>();
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
  const withCompany = async (stock: StockEntry): Promise<StockEntry> => {
    if (stock.companyName && stock.cik) {
      return stock;
    }
    try {
      const company = await sec.lookupCompanyProfile(stock.symbol);
      const updated = await store.updateStockCompany(stock.id, {
        companyName: company.companyName,
        cik: company.cik,
        exchange: company.exchange,
        industry: company.industry,
        investorRelationsUrl: company.investorRelationsUrl,
      });
      return { ...stock, ...updated };
    } catch {
      return stock;
    }
  };

  const requestsForChat = async (chatId: bigint): Promise<SourceRequest[]> => {
    const chat = await store.getChat('STOCKS', chatId);
    if (!chat) {
      return [];
    }
    const stocks = await Promise.all(
      (await store.listStocks(chat.id)).map(withCompany),
    );
    return stocks
      .filter((stock) => stock.enabled)
      .flatMap((stock) =>
        stock.sources
          .filter((entry) => entry.enabled)
          .flatMap((entry): SourceRequest[] => {
            const target = stockDisplayName(stock);
            if (entry.source === StockSourceType.SEC) {
              return [
                {
                  source: sec,
                  target,
                  config: { symbol: stock.symbol, cik: stock.cik ?? undefined },
                },
              ];
            }
            if (entry.source === StockSourceType.PRICE) {
              return [
                {
                  source: price,
                  target,
                  config: { symbol: stock.symbol },
                },
              ];
            }
            if (entry.source === StockSourceType.INVESTOR_RELATIONS) {
              return [
                {
                  source: investorRelations,
                  target,
                  config: {
                    symbol: stock.symbol,
                    investorRelationsUrl: stock.investorRelationsUrl,
                  },
                },
              ];
            }
            if (entry.source === StockSourceType.NEWS) {
              return [
                {
                  source: news,
                  target,
                  config: {
                    symbol: stock.symbol,
                    companyName: stock.companyName,
                  },
                },
              ];
            }
            if (entry.source === StockSourceType.TRADINGVIEW_NEWS) {
              return [
                {
                  source: tradingViewNews,
                  target,
                  config: {
                    symbol: stock.symbol,
                    companyName: stock.companyName,
                    exchange: stock.exchange,
                  },
                },
              ];
            }
            if (entry.source === StockSourceType.FINVIZ) {
              return [
                {
                  source: finviz,
                  target,
                  config: { symbol: stock.symbol },
                },
              ];
            }
            if (entry.source === StockSourceType.ZACKS) {
              return [
                {
                  source: zacks,
                  target,
                  config: { symbol: stock.symbol },
                },
              ];
            }
            if (entry.source === StockSourceType.EARNINGS_WHISPERS) {
              return [
                {
                  source: earningsWhispers,
                  target,
                  config: { symbol: stock.symbol },
                },
              ];
            }
            if (entry.source === StockSourceType.FINRA_SHORT_INTEREST) {
              return [
                {
                  source: shortInterest,
                  target,
                  config: { symbol: stock.symbol },
                },
              ];
            }
            if (entry.source === StockSourceType.CLINICAL_TRIALS) {
              return [
                {
                  source: clinicalTrials,
                  target,
                  config: {
                    symbol: stock.symbol,
                    companyName: stock.companyName,
                  },
                },
              ];
            }
            if (entry.source === StockSourceType.FDA) {
              return [
                {
                  source: fda,
                  target,
                  config: {
                    symbol: stock.symbol,
                    companyName: stock.companyName,
                  },
                },
              ];
            }
            if (
              entry.source === StockSourceType.ALPHA_VANTAGE_INSTITUTIONAL &&
              alphaInstitutional
            ) {
              return [
                {
                  source: alphaInstitutional,
                  target,
                  config: { symbol: stock.symbol },
                },
              ];
            }
            if (
              entry.source === StockSourceType.ALPHA_VANTAGE_OPTIONS &&
              alphaOptions
            ) {
              return [
                {
                  source: alphaOptions,
                  target,
                  config: { symbol: stock.symbol },
                },
              ];
            }
            const quiver = quiverSources.get(entry.source);
            if (quiver) {
              return [
                {
                  source: quiver,
                  target,
                  config: { symbol: stock.symbol },
                },
              ];
            }
            return [];
          })
          .map((request) => ({ ...request, targetKey: stock.symbol })),
      );
  };

  const notify = async (
    chatId: bigint,
    result: PipelineResult,
    manual: boolean,
  ): Promise<void> => {
    if (!manual) return;
    if (!hasReportableStockInformation(result)) return;
    await sendSplitMessage(
      api,
      chatId,
      renderStockDigest(reportableStockResult(result)),
    );
  };
  return new WatcherRunner(
    'STOCKS',
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
