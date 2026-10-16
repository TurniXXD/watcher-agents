import { createLogger, ReadinessServer } from '@watcher/core';
import {
  createDatabaseClient,
  PostgresOllamaCoordinator,
  SocialsStore,
} from '@watcher/database';
import { OllamaProvider } from '@watcher/llm';
import { parseAllowedUserIds } from '@watcher/telegram';
import {
  GoogleSheetsNetworkRepository,
  NetworkAiService,
  OllamaBusinessCardParser,
  type NetworkBotDependencies,
} from '@watcher/contact-network';
import { createNetworkingBot, networkingBotCommands } from './bot.js';
import { env } from './env.js';
import { NetworkingScheduler } from './scheduler.js';
import { NetworkingService } from './service.js';

const logger = createLogger('networking-bot', env.LOG_LEVEL);
const database = createDatabaseClient(env.DATABASE_URL);
const store = new SocialsStore(database);
const coordinator = new PostgresOllamaCoordinator(database, logger);
const llm =
  env.OLLAMA_URL && env.OLLAMA_MODEL
    ? new OllamaProvider({
        url: env.OLLAMA_URL,
        model: env.OLLAMA_MODEL,
        retries: 1,
        timeoutMs: env.OLLAMA_TIMEOUT_MS,
        numPredict: 900,
        think: false,
        caller: 'networking-bot',
        priority: 'normal',
        coordinator,
      })
    : undefined;
const contacts: NetworkBotDependencies | undefined =
  env.GOOGLE_SHEETS_SPREADSHEET_ID &&
  env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
  env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
    ? {
        repository: new GoogleSheetsNetworkRepository({
          spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID,
          range: env.GOOGLE_SHEETS_NETWORK_RANGE,
          serviceAccountEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
          serviceAccountPrivateKey: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
        }),
        ai: new NetworkAiService(llm),
        ...(env.OLLAMA_URL && env.NETWORK_OLLAMA_VISION_MODEL
          ? {
              cardParser: new OllamaBusinessCardParser(
                env.OLLAMA_URL,
                env.NETWORK_OLLAMA_VISION_MODEL,
                env.OLLAMA_TIMEOUT_MS,
              ),
            }
          : {}),
        telegramToken: env.NETWORKING_TELEGRAM_TOKEN,
        logger,
      }
    : undefined;
const service = new NetworkingService(store);
const bot = createNetworkingBot({
  token: env.NETWORKING_TELEGRAM_TOKEN,
  allowedIds: parseAllowedUserIds(env.TELEGRAM_ALLOWED_USER_IDS),
  store,
  service,
  timezone: env.NETWORKING_TIMEZONE,
  ...(contacts ? { contacts } : {}),
  reportError: (error) =>
    logger.error({ err: error }, 'Networking Telegram update failed'),
});
const scheduler = new NetworkingScheduler({
  store,
  intervalMs: env.NETWORKING_SCHEDULER_INTERVAL_MS,
  defaultTimezone: env.NETWORKING_TIMEZONE,
  transport: {
    send: async (chatId, text) => {
      await bot.api.sendMessage(chatId.toString(), text, {
        link_preview_options: { is_disabled: true },
      });
    },
  },
  logger,
});
const readiness = new ReadinessServer(async () => {
  await database.$queryRaw`SELECT 1`;
}, logger);

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'Shutting down networking bot');
  readiness.markApplicationStopping();
  await scheduler.stop();
  await bot.stop();
  await readiness.stop();
  await database.$disconnect();
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await readiness.start(env.NETWORKING_HEALTH_PORT);
await bot.api.setMyCommands(networkingBotCommands);
scheduler.start();
await bot.start({
  onStart: () => {
    readiness.markApplicationReady();
    logger.info(
      {
        contactsConfigured: Boolean(contacts),
        businessCardVisionConfigured: Boolean(contacts?.cardParser),
        timezone: env.NETWORKING_TIMEZONE,
      },
      'Networking bot started',
    );
  },
});
