import { createLogger, ReadinessServer } from '@watcher/core';
import {
  createDatabaseClient,
  PostgresOllamaCoordinator,
  SocialsStore,
} from '@watcher/database';
import { OllamaProvider } from '@watcher/llm';
import { NotionClient } from '@watcher/notion';
import { parseAllowedUserIds } from '@watcher/telegram';
import { createSocialsBot } from './bot.js';
import { LightweightIdeaClassifier } from './classifier.js';
import { env } from './env.js';
import { SocialNotionSync } from './notion.js';
import { SocialsScheduler } from './scheduler.js';
import { SocialsService } from './service.js';
import { HttpSocialTranscriber } from './transcription.js';

const logger = createLogger('socials-bot', env.LOG_LEVEL);
const database = createDatabaseClient(env.DATABASE_URL);
const store = new SocialsStore(database);
const coordinator = new PostgresOllamaCoordinator(database, logger);
const llm = env.SOCIALS_OLLAMA_ENABLED
  ? new OllamaProvider({
      url: env.OLLAMA_URL,
      model: env.OLLAMA_MODEL,
      retries: 1,
      timeoutMs: env.SOCIALS_OLLAMA_TIMEOUT_MS,
      numPredict: 256,
      think: false,
      caller: 'socials-bot',
      priority: 'low',
      coordinator,
    })
  : undefined;
const notionClient = env.NOTION_API_KEY
  ? new NotionClient({
      apiKey: env.NOTION_API_KEY,
      apiVersion: env.NOTION_API_VERSION,
    })
  : undefined;
const notion =
  notionClient && env.NOTION_SOCIALS_DATA_SOURCE_ID
    ? new SocialNotionSync(
        store,
        notionClient,
        env.NOTION_SOCIALS_DATA_SOURCE_ID,
      )
    : undefined;
const service = new SocialsService({
  store,
  classifier: new LightweightIdeaClassifier(llm),
  timezone: env.SOCIALS_TIMEZONE,
  ...(notion ? { notion } : {}),
  logger,
});
const transcriber = env.SOCIALS_TRANSCRIPTION_URL
  ? new HttpSocialTranscriber({
      url: env.SOCIALS_TRANSCRIPTION_URL,
      ...(env.SOCIALS_TRANSCRIPTION_API_KEY
        ? { apiKey: env.SOCIALS_TRANSCRIPTION_API_KEY }
        : {}),
      model: env.SOCIALS_TRANSCRIPTION_MODEL,
    })
  : undefined;

const bot = createSocialsBot({
  token: env.SOCIALS_TELEGRAM_TOKEN,
  allowedIds: parseAllowedUserIds(env.TELEGRAM_ALLOWED_USER_IDS),
  store,
  service,
  timezone: env.SOCIALS_TIMEZONE,
  ...(transcriber ? { transcriber } : {}),
  download: async (fileId) => {
    const file = await bot.api.getFile(fileId);
    if (!file.file_path) throw new Error('Telegram did not return a file path');
    const response = await fetch(
      `https://api.telegram.org/file/bot${env.SOCIALS_TELEGRAM_TOKEN}/${file.file_path}`,
      { signal: AbortSignal.timeout(120_000) },
    );
    if (!response.ok) {
      throw new Error(
        `Telegram file download returned HTTP ${response.status}`,
      );
    }
    return new Uint8Array(await response.arrayBuffer());
  },
  reportError: (error) => logger.error({ err: error }, 'Socials update failed'),
});
const scheduler = new SocialsScheduler({
  store,
  service,
  intervalMs: env.SOCIALS_SCHEDULER_INTERVAL_MS,
  defaultTimezone: env.SOCIALS_TIMEZONE,
  defaultReminderTime: env.SOCIALS_SUNDAY_REMINDER_TIME,
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
  logger.info({ signal }, 'Shutting down socials bot');
  readiness.markApplicationStopping();
  await scheduler.stop();
  await bot.stop();
  await readiness.stop();
  await database.$disconnect();
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
await readiness.start(env.SOCIALS_HEALTH_PORT);
scheduler.start();
await bot.start({
  onStart: () => {
    readiness.markApplicationReady();
    logger.info(
      {
        notionConfigured: Boolean(notion),
        qwenEnabled: env.SOCIALS_OLLAMA_ENABLED,
        timezone: env.SOCIALS_TIMEZONE,
      },
      'Socials bot started',
    );
  },
});
