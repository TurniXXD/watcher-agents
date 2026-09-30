import { createLogger } from '@watcher/core';
import { createDatabaseClient, SalesStore } from '@watcher/database';
import { parseAllowedUserIds } from '@watcher/telegram';
import { SalesApi } from './api.js';
import { createSalesBot } from './bot.js';
import { env } from './env.js';
import { QuicklyClient, TwentyClient } from './providers.js';
import { SalesService } from './service.js';

const logger = createLogger('sales-bot', env.LOG_LEVEL);
const database = createDatabaseClient(env.DATABASE_URL);
const store = new SalesStore(database);
const quickly =
  env.QUICKLY_BASE_URL && env.QUICKLY_API_KEY
    ? new QuicklyClient(env.QUICKLY_BASE_URL, env.QUICKLY_API_KEY)
    : undefined;
const twenty =
  env.TWENTY_BASE_URL && env.TWENTY_API_KEY
    ? new TwentyClient(env.TWENTY_BASE_URL, env.TWENTY_API_KEY)
    : undefined;
const service = new SalesService(store, logger, quickly, twenty);
const allowed = parseAllowedUserIds(env.TELEGRAM_ALLOWED_USER_IDS);
const bot = createSalesBot(env.SALES_TELEGRAM_TOKEN, allowed, store, service);
const api = new SalesApi(
  store,
  service,
  env.SALES_API_TOKEN,
  env.SALES_WEBHOOK_TOKEN,
  logger,
  async (message) => {
    for (const userId of allowed) {
      try {
        await bot.api.sendMessage(userId, message);
      } catch (error) {
        logger.warn(
          { err: error, userId },
          'Sales Telegram notification failed',
        );
      }
    }
  },
);

await api.start(env.SALES_PORT);
const interval = setInterval(() => {
  void service
    .run()
    .catch((error) =>
      logger.error({ err: error }, 'Scheduled sales run failed'),
    );
}, env.SALES_INTERVAL_MINUTES * 60_000);
const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down sales bot');
  clearInterval(interval);
  await bot.stop();
  await api.stop();
  await database.$disconnect();
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
void service
  .run()
  .catch((error) => logger.error({ err: error }, 'Initial sales run failed'));
await bot.start({ onStart: () => logger.info({}, 'Sales bot started') });
