import { createLogger, errorMessage, PersistentScheduler } from '@watcher/core';
import {
  createDatabaseClient,
  SalesStore,
  TelegramOutboxStore,
} from '@watcher/database';
import { parseAllowedUserIds } from '@watcher/telegram';
import { SalesApi } from './api.js';
import { createSalesBot, salesBotCommands } from './bot.js';
import { env } from './env.js';
import {
  enqueueFollowupReports,
  followupSlotAt,
  localDate,
  salesFollowupKind,
} from './followup-report.js';
import { QuicklyClient, TwentyClient } from './providers.js';
import { SalesService } from './service.js';

const logger = createLogger('sales-bot', env.LOG_LEVEL);
const database = createDatabaseClient(env.DATABASE_URL);
const store = new SalesStore(database);
const outbox = new TelegramOutboxStore(database);
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
const followupScheduler = new PersistentScheduler(
  (now) => {
    const slot = followupSlotAt(
      now,
      env.SALES_TIMEZONE,
      env.SALES_FOLLOWUP_TIME,
    );
    return Promise.resolve(slot ? [{ id: slot.date }] : []);
  },
  async () => {
    const count = await enqueueFollowupReports(
      new Date(),
      env.SALES_TIMEZONE,
      env.SALES_FOLLOWUP_TIME,
      allowed,
      store,
      outbox,
    );
    if (count > 0)
      logger.info({ recipients: count }, 'Sales cold-call report queued');
  },
  60_000,
  logger,
);
const outboxScheduler = new PersistentScheduler(
  (now) => outbox.claimDue(now, 10, undefined, [salesFollowupKind]),
  async (due) => {
    const message = due as Awaited<ReturnType<typeof outbox.claimDue>>[number];
    if (
      message.kind !== salesFollowupKind ||
      !allowed.has(Number(message.chatId)) ||
      message.deduplicationKey.split(':')[1] !==
        localDate(new Date(), env.SALES_TIMEZONE) ||
      !followupSlotAt(new Date(), env.SALES_TIMEZONE, '00:00')
    ) {
      await outbox.markFailed(message, 'Sales report is stale or not allowed');
      return;
    }
    try {
      const sent = await bot.api.sendMessage(
        message.chatId.toString(),
        message.body,
        { link_preview_options: { is_disabled: true } },
      );
      await outbox.markDelivered(message, String(sent.message_id));
    } catch (error) {
      const retryAt =
        message.attemptCount >= 6
          ? undefined
          : new Date(
              Date.now() +
                Math.min(60 * 60_000, 30_000 * 2 ** (message.attemptCount - 1)),
            );
      await outbox.markFailed(message, errorMessage(error), retryAt);
      logger.warn(
        { err: error, outboxMessageId: message.id, retryAt },
        'Sales report Telegram delivery failed',
      );
    }
  },
  30_000,
  logger,
);
followupScheduler.start();
outboxScheduler.start();
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
  await followupScheduler.stop();
  await outboxScheduler.stop();
  await bot.stop();
  await api.stop();
  await database.$disconnect();
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
void service
  .run()
  .catch((error) => logger.error({ err: error }, 'Initial sales run failed'));
await bot.api.setMyCommands([...salesBotCommands]);
await bot.start({ onStart: () => logger.info({}, 'Sales bot started') });
