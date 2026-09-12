import {
  PersistentScheduler,
  ReadinessServer,
  checkOllamaReady,
  createLogger,
  errorMessage,
} from '@watcher/core';
import {
  CompanyUniverseManager,
  InProcessEventBus,
  StockIntelligenceAnalyzer,
  defaultDiscoveryPolicy,
} from './core/index.js';
import {
  CompanyUniverseStore,
  BriefingWatcherHealthStore,
  AgentTelemetryStore,
  PostgresEventJournal,
  PostgresBriefingEventRepository,
  PostgresOllamaCoordinator,
  StockDiscoveryStore,
  StockNewsStore,
  createDatabaseClient,
  WatcherStore,
  ValidationStore,
} from '@watcher/database';
import { OllamaEmbeddingProvider, OllamaProvider } from '@watcher/llm';
import {
  AlphaVantageDiscoveryScanner,
  SecEdgarSource,
} from './sources/index.js';
import {
  parseAllowedUserIds,
  renderStockAlertBatch,
  sendSplitMessage,
} from '@watcher/telegram';
import { createStocksBot } from './bot.js';
import { StockDiscoveryCoordinator } from './discovery.js';
import { env } from './env.js';
import { StockReconciliationCoordinator } from './reconciliation.js';
import { StockCandidateProcessor } from './stock-candidate-processor.js';
import { createStocksRunner } from './watcher.js';
import {
  publishEarningsReminderBriefingEvents,
  publishStockBriefingEvents,
} from './briefing-publisher.js';

const logger = createLogger('stocks-bot', env.LOG_LEVEL);
const database = createDatabaseClient(env.DATABASE_URL);
const ollamaCoordinator = new PostgresOllamaCoordinator(database, logger);
const stockEmbeddingProvider = env.BRIEFING_EMBEDDING_MODEL
  ? new OllamaEmbeddingProvider({
      url: env.OLLAMA_URL,
      model: env.BRIEFING_EMBEDDING_MODEL,
      keepAlive: env.OLLAMA_KEEP_ALIVE,
      timeoutMs: env.OLLAMA_TIMEOUT_MS,
      caller: 'stocks-bot',
      priority: 'normal',
      coordinator: ollamaCoordinator,
    })
  : undefined;
const readiness = new ReadinessServer(async () => {
  await database.$queryRaw`SELECT 1`;
  await checkOllamaReady(env.OLLAMA_URL);
}, logger);
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
  notificationPolicy: {
    batchWindowMinutes: env.STOCK_ALERT_BATCH_WINDOW_MINUTES,
    notificationStartHour: env.STOCK_NOTIFICATION_START_HOUR,
    notificationEndHour: env.STOCK_NOTIFICATION_END_HOUR,
    extremeImmediate: env.STOCK_EXTREME_IMMEDIATE,
  },
  ...(stockEmbeddingProvider && env.BRIEFING_EMBEDDING_MODEL
    ? {
        stockEventSemantic: {
          model: env.BRIEFING_EMBEDDING_MODEL,
          provider: {
            embed: (input: readonly string[], signal?: AbortSignal) =>
              stockEmbeddingProvider.embed(input, signal),
          },
          minimumSimilarity: env.BRIEFING_EMBEDDING_MIN_SIMILARITY,
          windowHours: env.BRIEFING_EMBEDDING_WINDOW_HOURS,
        },
      }
    : {}),
  logger,
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
const telemetry = new AgentTelemetryStore(database);
const universeStore = new CompanyUniverseStore(database);
const validationStore = new ValidationStore(database);
const stockNews = new StockNewsStore(database);
const eventBus = new InProcessEventBus(new PostgresEventJournal(database));
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
  caller: 'stocks-bot',
  priority: 'normal',
  coordinator: ollamaCoordinator,
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
const deliverAlertBatch = async (
  configId: string,
  chatId: bigint,
): Promise<void> => {
  const alerts = await store.claimPendingAlerts(configId);
  if (alerts.length === 0) return;
  try {
    await sendSplitMessage(bot.api, chatId, renderStockAlertBatch(alerts));
    await Promise.all(
      alerts.map((alert) => store.markAlertDelivered(alert.id)),
    );
  } catch (error) {
    const message = errorMessage(error);
    await Promise.all(
      alerts.map((alert) => store.markAlertDeliveryFailed(alert.id, message)),
    );
    logger.error(
      { alertIds: alerts.map(({ id }) => id), err: error },
      'Stock alert batch delivery failed',
    );
  }
};
const discoveryEnabled = Boolean(env.ALPHA_VANTAGE_API_KEY);
const bot = createStocksBot(
  env.STOCKS_TELEGRAM_TOKEN,
  parseAllowedUserIds(env.TELEGRAM_ALLOWED_USER_IDS),
  store,
  stockNews,
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
    let reminderPublication = { published: 0, failed: 0 };
    const chatConfig = await store.getChat('STOCKS', chatId);
    if (chatConfig) {
      reminderPublication = await publishEarningsReminderBriefingEvents(
        briefingEvents,
        await store.listUpcomingEarningsReminderCandidates(chatConfig.id),
        logger,
        new Date(),
        chatConfig.watcherConfig?.timezone ?? env.DEFAULT_TIMEZONE,
      );
      logger.info(
        reminderPublication,
        'Earnings reminder briefing events published',
      );
      await discoveryStore.escalateAttentionSignals(
        chatConfig.id,
        result.intelligence,
      );
      await discoveryStore.promoteMaterialEvents(
        chatConfig.id,
        result.intelligence,
      );
      await deliverAlertBatch(chatConfig.watcherConfig!.id, chatId);
    }
    const publishedEvents =
      publication.published + reminderPublication.published;
    const failedEventPublications =
      publication.failed + reminderPublication.failed;
    const health = await briefingWatcherHealth.recordRun({
      watcherBot: 'stocks',
      degraded:
        result.sourceFailures.length > 0 ||
        result.failedAnalysisCount > 0 ||
        failedEventPublications > 0,
      eventsEmitted: publishedEvents,
      failedEventPublications,
      sourceFailures: result.sourceFailures.length,
    });
    logger.info(
      {
        watcherBot: health.watcherBot,
        watcherHealth: health.status,
        stockEventsPublished: publication.published,
        earningsRemindersPublished: reminderPublication.published,
      },
      'Briefing producer health updated',
    );
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
  telemetry,
);
runtime.runner = runner;
const candidateProcessor = new StockCandidateProcessor(eventBus, runner);
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
      await candidateProcessor.processStockCandidate({
        type: 'stock.market_anomaly.detected',
        configId,
        chatId,
        tickers,
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
  undefined,
  logger,
);
const discoveryScheduler = new PersistentScheduler(
  (now) =>
    runtime.discovery ? discoveryStore.listDueScans(now) : Promise.resolve([]),
  async (due) => {
    const entry = due as { id: string; chatId: bigint };
    await runtime.discovery?.execute(entry.id, entry.chatId, 'SCHEDULED');
  },
  undefined,
  logger,
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
  undefined,
  logger,
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
  undefined,
  logger,
);
const alertScheduler = new PersistentScheduler(
  (now) => store.listDueAlertBatches(now),
  async (due) => {
    const entry = due as { id: string; chatConfig: { chatId: bigint } };
    await deliverAlertBatch(entry.id, entry.chatConfig.chatId);
  },
  30_000,
  logger,
);

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'Shutting down');
  readiness.markApplicationStopping();
  await Promise.all([
    scheduler.stop(),
    discoveryScheduler.stop(),
    highResolutionScheduler.stop(),
    reconciliationScheduler.stop(),
    alertScheduler.stop(),
  ]);
  await bot.stop();
  candidateProcessor.stop();
  await readiness.stop();
  await database.$disconnect();
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
scheduler.start();
discoveryScheduler.start();
highResolutionScheduler.start();
reconciliationScheduler.start();
alertScheduler.start();
await readiness.start();
await bot.start({
  onStart: () => {
    readiness.markApplicationReady();
    logger.info('Stocks bot started');
  },
});
