import { PersistentScheduler, createLogger, errorMessage } from '@watcher/core';
import {
  CompanyUniverseManager,
  InProcessEventBus,
  StockIntelligenceAnalyzer,
  defaultDiscoveryPolicy,
} from './core/index.js';
import {
  CompanyUniverseStore,
  BriefingWatcherHealthStore,
  PostgresBriefingEventRepository,
  StockDiscoveryStore,
  createDatabaseClient,
  WatcherStore,
  ValidationStore,
} from '@watcher/database';
import { OllamaProvider } from '@watcher/llm';
import {
  AlphaVantageDiscoveryScanner,
  SecEdgarSource,
} from './sources/index.js';
import {
  parseAllowedUserIds,
  renderStockAlert,
  sendSplitMessage,
} from '@watcher/telegram';
import { createStocksBot } from './bot.js';
import { StockDiscoveryCoordinator } from './discovery.js';
import { env } from './env.js';
import { StockReconciliationCoordinator } from './reconciliation.js';
import { createStocksRunner } from './watcher.js';
import { publishStockBriefingEvents } from './briefing-publisher.js';

const logger = createLogger('stocks-bot', env.LOG_LEVEL);
const database = createDatabaseClient(env.DATABASE_URL);
const briefingEvents = new PostgresBriefingEventRepository(database, logger);
const briefingWatcherHealth = new BriefingWatcherHealthStore(database);
const availableStockSourceIds = new Set([
  'SEC',
  'INVESTOR_RELATIONS',
  'NEWS',
  'TRADINGVIEW_NEWS',
  'PRICE',
  'FINVIZ',
  'ZACKS',
  'EARNINGS_WHISPERS',
  'FINRA_SHORT_INTEREST',
  'CLINICAL_TRIALS',
  'FDA',
  ...(env.ALPHA_VANTAGE_API_KEY ? ['ALPHA_VANTAGE_INSTITUTIONAL'] : []),
  ...(env.ALPHA_VANTAGE_API_KEY && env.ALPHA_VANTAGE_OPTIONS_ENABLED
    ? ['ALPHA_VANTAGE_OPTIONS']
    : []),
  ...(env.QUIVER_API_TOKEN
    ? [
        'QUIVER_INSIDERS',
        'QUIVER_CONTRACTS',
        'QUIVER_PATENTS',
        'QUIVER_CONGRESS',
        'QUIVER_OFF_EXCHANGE',
        'QUIVER_LOBBYING',
      ]
    : []),
]);
const store = new WatcherStore(database, {
  eventCooldownMs: env.STOCK_EVENT_COOLDOWN_MINUTES * 60_000,
  tickerCooldownMs: env.STOCK_TICKER_ANALYSIS_COOLDOWN_MINUTES * 60_000,
  sourceBackoffBaseMs: env.SOURCE_BACKOFF_BASE_SECONDS * 1000,
  sourceBackoffMaximumMs: env.SOURCE_BACKOFF_MAX_MINUTES * 60_000,
  alertAttentionThreshold: env.ALERT_ATTENTION_THRESHOLD,
  availableStockSourceIds,
  marketAnomalyPolicy: {
    priceMovePercent: env.PRICE_ANOMALY_THRESHOLD_PERCENT,
    gapPercent: env.GAP_ANOMALY_THRESHOLD_PERCENT,
    relativeVolume: env.RELATIVE_VOLUME_ANOMALY_THRESHOLD,
    volatilityExpansion: env.VOLATILITY_EXPANSION_THRESHOLD,
    minimumVolumeBaseline: env.MARKET_BASELINE_MIN_SNAPSHOTS,
  },
  advancedSignalPolicy: {
    optionsVolumeOiRatio: env.OPTIONS_VOLUME_OI_ANOMALY_THRESHOLD,
    optionsVolumeBaselineMultiple: env.OPTIONS_VOLUME_BASELINE_MULTIPLIER,
    minimumOptionsBaseline: env.OPTIONS_BASELINE_MIN_SNAPSHOTS,
    institutionalChangePercent: env.INSTITUTIONAL_CHANGE_THRESHOLD_PERCENT,
    shortInterestChangePercent: env.SHORT_INTEREST_CHANGE_THRESHOLD_PERCENT,
    shortInterestDaysToCover: env.SHORT_INTEREST_DAYS_TO_COVER_THRESHOLD,
  },
});
const universeStore = new CompanyUniverseStore(database);
const validationStore = new ValidationStore(database);
const eventBus = new InProcessEventBus();
const universe = new CompanyUniverseManager(universeStore, eventBus);
const sec = new SecEdgarSource(env.SEC_USER_AGENT);
const discoveryStore = new StockDiscoveryStore(database, {
  investigationMs: env.DISCOVERY_INVESTIGATION_MINUTES * 60_000,
  highResolutionIntervalMs:
    env.DISCOVERY_HIGH_RESOLUTION_INTERVAL_MINUTES * 60_000,
  eventModeMs: env.DISCOVERY_EVENT_MODE_MINUTES * 60_000,
  watchMs: env.DISCOVERY_WATCH_DAYS * 24 * 60 * 60_000,
});
const ollama = new OllamaProvider({
  url: env.OLLAMA_URL,
  model: env.OLLAMA_MODEL,
  keepAlive: env.OLLAMA_KEEP_ALIVE,
  numCtx: env.OLLAMA_NUM_CTX,
  numPredict: env.OLLAMA_NUM_PREDICT,
  retries: env.OLLAMA_RETRIES,
  think: env.OLLAMA_THINK,
  timeoutMs: env.OLLAMA_TIMEOUT_MS,
});
const analyzer = new StockIntelligenceAnalyzer(
  ollama,
  env.OLLAMA_FULL_ANALYSIS_NUM_PREDICT,
);
const runtime: {
  runner?: ReturnType<typeof createStocksRunner>;
  discovery?: StockDiscoveryCoordinator;
  reconciliation?: StockReconciliationCoordinator;
} = {};
const discoveryEnabled = Boolean(env.ALPHA_VANTAGE_API_KEY);
const bot = createStocksBot(
  env.STOCKS_TELEGRAM_TOKEN,
  parseAllowedUserIds(env.TELEGRAM_ALLOWED_USER_IDS),
  store,
  validationStore,
  env.VALIDATION_MIN_SAMPLE_SIZE,
  universe,
  (configId, chatId, options) => {
    if (!runtime.runner) {
      throw new Error('Stocks runner is not ready');
    }
    return runtime.runner.execute(configId, chatId, 'MANUAL', options);
  },
  (symbol) => sec.lookupCompanyProfile(symbol),
  discoveryEnabled,
  (configId, chatId) => {
    if (!runtime.discovery) {
      throw new Error('Discovery scanner is not configured');
    }
    return runtime.discovery.execute(configId, chatId, 'MANUAL');
  },
  (chatConfigId) => discoveryStore.status(chatConfigId),
  (configId, chatId) => {
    if (!runtime.reconciliation) {
      throw new Error('Reconciliation coordinator is not ready');
    }
    return runtime.reconciliation.execute(configId, chatId, 'MANUAL');
  },
  env.DEFAULT_TIMEZONE,
  (error) => logger.error({ err: error }, 'Telegram update failed'),
);
const runner = createStocksRunner(
  store,
  analyzer,
  bot.api,
  sec,
  {
    alphaVantageApiKey: env.ALPHA_VANTAGE_API_KEY,
    alphaVantageOptionsEnabled: env.ALPHA_VANTAGE_OPTIONS_ENABLED,
    quiverToken: env.QUIVER_API_TOKEN,
  },
  env.OLLAMA_MAX_ITEMS_PER_RUN,
  logger,
  async (chatId, result) => {
    const publication = await publishStockBriefingEvents(
      briefingEvents,
      result,
      logger,
    );
    logger.info(publication, 'Stock briefing events published');
    const health = await briefingWatcherHealth.recordRun({
      watcherBot: 'stocks',
      degraded:
        result.sourceFailures.length > 0 ||
        result.failedAnalysisCount > 0 ||
        publication.failed > 0,
      eventsEmitted: publication.published,
      failedEventPublications: publication.failed,
      sourceFailures: result.sourceFailures.length,
    });
    logger.info(
      { watcherBot: health.watcherBot, watcherHealth: health.status },
      'Briefing producer health updated',
    );
    const chatConfig = await store.getChat('STOCKS', chatId);
    if (chatConfig) {
      await discoveryStore.escalateAttentionSignals(
        chatConfig.id,
        result.intelligence,
      );
      await discoveryStore.promoteMaterialEvents(
        chatConfig.id,
        result.intelligence,
      );
      const alerts = await store.claimPendingAlerts(
        chatConfig.watcherConfig!.id,
      );
      for (const alert of alerts) {
        try {
          await sendSplitMessage(bot.api, chatId, renderStockAlert(alert));
          await store.markAlertDelivered(alert.id);
        } catch (error) {
          const message = errorMessage(error);
          await store.markAlertDeliveryFailed(alert.id, message);
          logger.error(
            { alertId: alert.id, ticker: alert.ticker, err: error },
            'Stock alert delivery failed',
          );
        }
      }
    }
  },
  async (_chatId, error) => {
    const health = await briefingWatcherHealth.recordFailure({
      watcherBot: 'stocks',
      error,
    });
    logger.warn(
      { watcherBot: health.watcherBot, watcherHealth: health.status },
      'Briefing producer marked unavailable',
    );
  },
);
runtime.runner = runner;
const reconciliationIntervalMs = env.RECONCILIATION_INTERVAL_MINUTES * 60_000;
runtime.reconciliation = new StockReconciliationCoordinator(
  store,
  runner,
  reconciliationIntervalMs,
  logger,
);
const scanIntervalMs = env.DISCOVERY_SCAN_INTERVAL_MINUTES * 60_000;
if (env.ALPHA_VANTAGE_API_KEY) {
  runtime.discovery = new StockDiscoveryCoordinator(
    discoveryStore,
    new AlphaVantageDiscoveryScanner(
      env.ALPHA_VANTAGE_API_KEY,
      env.DISCOVERY_MARKET_DATA_ENTITLEMENT,
    ),
    (symbol) => sec.lookupCompanyProfile(symbol),
    async (configId, chatId, tickers) => {
      await runner.execute(configId, chatId, 'SCHEDULED', {
        targetKeys: new Set(tickers),
      });
    },
    env.DISCOVERY_MARKET_DATA_ENTITLEMENT === 'EOD' ? 'DAILY' : 'INTRADAY',
    scanIntervalMs,
    {
      ...defaultDiscoveryPolicy,
      moveThresholdPercent: env.DISCOVERY_MOVE_THRESHOLD_PERCENT,
      minimumPrice: env.DISCOVERY_MIN_PRICE,
      minimumVolume: env.DISCOVERY_MIN_VOLUME,
      minimumDollarVolume: env.DISCOVERY_MIN_DOLLAR_VOLUME,
      maximumCandidates: env.DISCOVERY_MAX_CANDIDATES,
      supportedExchanges: env.DISCOVERY_SUPPORTED_EXCHANGES.split(',')
        .map((exchange) => exchange.trim())
        .filter(Boolean),
      excludeOtc: env.DISCOVERY_EXCLUDE_OTC,
    },
    logger,
  );
  await discoveryStore.initializeSchedules(scanIntervalMs);
}
const scheduler = new PersistentScheduler(
  (now) => store.listDue('STOCKS', now),
  async (due) => {
    const entry = due as { id: string; chatConfig: { chatId: bigint } };
    await runner.execute(entry.id, entry.chatConfig.chatId, 'SCHEDULED');
  },
);
const discoveryScheduler = new PersistentScheduler(
  (now) =>
    runtime.discovery ? discoveryStore.listDueScans(now) : Promise.resolve([]),
  async (due) => {
    const entry = due as { id: string; chatId: bigint };
    await runtime.discovery?.execute(entry.id, entry.chatId, 'SCHEDULED');
  },
);
const fastSourceIds = new Set([
  'SEC',
  'INVESTOR_RELATIONS',
  'NEWS',
  'TRADINGVIEW_NEWS',
  'PRICE',
  'QUIVER_INSIDERS',
  ...(env.ALPHA_VANTAGE_OPTIONS_ENABLED ? ['ALPHA_VANTAGE_OPTIONS'] : []),
]);
const highResolutionScheduler = new PersistentScheduler(
  async (now) => {
    await discoveryStore.reconcileExpired(now);
    return discoveryStore.claimDueHighResolutionRuns(now);
  },
  async (due) => {
    const entry = due as { id: string; chatId: bigint; tickers: string[] };
    await runner.execute(entry.id, entry.chatId, 'SCHEDULED', {
      targetKeys: new Set(entry.tickers),
      sourceIds: fastSourceIds,
    });
  },
);
const reconciliationScheduler = new PersistentScheduler(
  (now) => store.listDueReconciliations('STOCKS', now),
  async (due) => {
    const entry = due as { id: string; chatConfig: { chatId: bigint } };
    await runtime.reconciliation?.execute(
      entry.id,
      entry.chatConfig.chatId,
      'SCHEDULED',
    );
  },
);

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'Shutting down');
  await Promise.all([
    scheduler.stop(),
    discoveryScheduler.stop(),
    highResolutionScheduler.stop(),
    reconciliationScheduler.stop(),
  ]);
  await bot.stop();
  await database.$disconnect();
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
scheduler.start();
discoveryScheduler.start();
highResolutionScheduler.start();
reconciliationScheduler.start();
await bot.start({ onStart: () => logger.info('Stocks bot started') });
