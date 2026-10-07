import {
  PersistentScheduler,
  ReadinessServer,
  createLogger,
} from '@watcher/core';
import { RealityStore, createDatabaseClient } from '@watcher/database';
import { parseAllowedUserIds, sendSplitMessage } from '@watcher/telegram';
import { createRealityBot, sendRealityAlert } from './bot.js';
import { env } from './env.js';
import { DigiRealityProvider } from './providers.js';
import { renderOpportunityAlert, renderRealityReport } from './report.js';
import { RealityService } from './service.js';
import { investmentModelSchema } from './types.js';

const logger = createLogger('reality-bot', env.LOG_LEVEL);
const database = createDatabaseClient(env.DATABASE_URL);
const store = new RealityStore(database);
const providers = new Map<string, DigiRealityProvider>();
const configuredProviders = async () => {
  const users = await store.listUsers();
  const locations = new Set([
    ...env.REALITY_DEFAULT_LOCATIONS,
    ...users.flatMap((user) => user.locations),
  ]);
  return [...locations].map((location) => {
    const existing = providers.get(location);
    if (existing) return existing;
    const provider = new DigiRealityProvider(
      location,
      env.REALITY_DIGIREALITY_KEY,
    );
    providers.set(location, provider);
    return provider;
  });
};
const service = new RealityService(store, configuredProviders, logger);
const defaults = {
  timezone: env.DEFAULT_TIMEZONE,
  schedule: env.REALITY_REPORT_SCHEDULE,
  locations: env.REALITY_DEFAULT_LOCATIONS,
};
const bot = createRealityBot(
  env.REALITY_TELEGRAM_TOKEN,
  parseAllowedUserIds(env.TELEGRAM_ALLOWED_USER_IDS),
  store,
  (chatId) =>
    service.runForUser(
      chatId,
      'MANUAL',
      (listing) => sendRealityAlert(bot, chatId, listing),
      defaults,
    ),
  defaults,
  (error) => logger.error({ err: error }, 'Telegram update failed'),
);
const readiness = new ReadinessServer(async () => {
  await database.$queryRaw`SELECT 1`;
}, logger);
const scheduler = new PersistentScheduler(
  (now) => store.listDue(now),
  async (due) => {
    const item = due as { id: string; telegramChatId: bigint };
    const result = await service.runForUser(
      item.telegramChatId,
      'SCHEDULED',
      (listing) => sendRealityAlert(bot, item.telegramChatId, listing),
      defaults,
    );
    if (result.status !== 'COMPLETED') return;
    const user = await store.getUser(item.telegramChatId);
    if (!user) return;
    const model = investmentModelSchema.parse(user.model);
    await sendSplitMessage(
      bot.api,
      item.telegramChatId,
      renderRealityReport(result.payload, user.locations, model),
    );
  },
  undefined,
  logger,
);

await readiness.start(env.REALITY_HEALTH_PORT);
scheduler.start();
const monitor = setInterval(
  () =>
    void service
      .monitor((chatId, listing) =>
        sendSplitMessage(bot.api, chatId, renderOpportunityAlert(listing)),
      )
      .catch((error) => logger.error({ err: error }, 'Reality monitor failed')),
  env.REALITY_MONITOR_INTERVAL_MINUTES * 60_000,
);
monitor.unref();
void service
  .monitor((chatId, listing) => sendRealityAlert(bot, chatId, listing))
  .catch((error) =>
    logger.error({ err: error }, 'Initial reality monitor failed'),
  );

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'Shutting down');
  readiness.markApplicationStopping();
  clearInterval(monitor);
  await scheduler.stop();
  await bot.stop();
  await readiness.stop();
  await database.$disconnect();
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
await bot.start({
  onStart: () => {
    readiness.markApplicationReady();
    logger.info({}, 'Reality bot started');
  },
});
