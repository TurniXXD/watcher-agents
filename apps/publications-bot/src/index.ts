import {
  PersistentScheduler,
  ReadinessServer,
  checkOllamaReady,
  createLogger,
} from '@watcher/core';
import {
  createDatabaseClient,
  BriefingWatcherHealthStore,
  AgentTelemetryStore,
  PostgresBriefingEventRepository,
  PostgresOllamaCoordinator,
  WatcherStore,
} from '@watcher/database';
import { OllamaProvider } from '@watcher/llm';
import { parseAllowedUserIds } from '@watcher/telegram';
import { createPublicationsBot } from './bot.js';
import { env } from './env.js';
import { createPublicationsRunner } from './watcher.js';
import { publishMedicalBriefingEvents } from './briefing-publisher.js';

const logger = createLogger('publications-bot', env.LOG_LEVEL);
const database = createDatabaseClient(env.DATABASE_URL);
const ollamaCoordinator = new PostgresOllamaCoordinator(database, logger);
const readiness = new ReadinessServer(async () => {
  await database.$queryRaw`SELECT 1`;
  await checkOllamaReady(env.OLLAMA_URL);
}, logger);
const briefingEvents = new PostgresBriefingEventRepository(database, logger);
const briefingWatcherHealth = new BriefingWatcherHealthStore(database);
const store = new WatcherStore(database, {
  sourceBackoffBaseMs: env.SOURCE_BACKOFF_BASE_SECONDS * 1000,
  sourceBackoffMaximumMs: env.SOURCE_BACKOFF_MAX_MINUTES * 60_000,
});
const telemetry = new AgentTelemetryStore(database);
const analyzer = new OllamaProvider({
  url: env.OLLAMA_URL,
  model: env.OLLAMA_MODEL,
  keepAlive: env.OLLAMA_KEEP_ALIVE,
  numCtx: env.OLLAMA_NUM_CTX,
  numPredict: env.OLLAMA_NUM_PREDICT,
  retries: env.OLLAMA_RETRIES,
  think: env.OLLAMA_THINK,
  timeoutMs: env.OLLAMA_TIMEOUT_MS,
  caller: 'publications-bot',
  priority: 'normal',
  coordinator: ollamaCoordinator,
});
const runtime: { runner?: ReturnType<typeof createPublicationsRunner> } = {};
const bot = createPublicationsBot(
  env.PUBLICATIONS_TELEGRAM_TOKEN,
  parseAllowedUserIds(env.TELEGRAM_ALLOWED_USER_IDS),
  store,
  (configId, chatId, options) => {
    if (!runtime.runner) throw new Error('Publications runner is not ready');
    return runtime.runner.execute(configId, chatId, 'MANUAL', options);
  },
  env.DEFAULT_TIMEZONE,
  (error) => logger.error({ err: error }, 'Telegram update failed'),
);
const runner = createPublicationsRunner(
  store,
  analyzer,
  bot.api,
  env.OLLAMA_MAX_ITEMS_PER_RUN,
  logger,
  async (_chatId, result) => {
    const publication = await publishMedicalBriefingEvents(
      briefingEvents,
      result,
      logger,
    );
    logger.info(publication, 'Medical briefing events published');
    const health = await briefingWatcherHealth.recordRun({
      watcherBot: 'medical',
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
  },
  async (_chatId, error) => {
    const health = await briefingWatcherHealth.recordFailure({
      watcherBot: 'medical',
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
const scheduler = new PersistentScheduler(
  (now) => store.listDue('PUBLICATIONS', now),
  async (due) => {
    const entry = due as { id: string; chatConfig: { chatId: bigint } };
    await runner.execute(entry.id, entry.chatConfig.chatId, 'SCHEDULED');
  },
  undefined,
  logger,
);
const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'Shutting down');
  readiness.markApplicationStopping();
  await scheduler.stop();
  await bot.stop();
  await readiness.stop();
  await database.$disconnect();
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
scheduler.start();
await readiness.start();
await bot.start({
  onStart: () => {
    readiness.markApplicationReady();
    logger.info('Publications bot started');
  },
});
