import { PersistentScheduler, createLogger } from '@watcher/core';
import { createDatabaseClient, WatcherStore } from '@watcher/database';
import { OllamaProvider } from '@watcher/llm';
import { parseAllowedUserIds } from '@watcher/telegram';
import { createPublicationsBot } from './bot.js';
import { env } from './env.js';
import { createPublicationsRunner } from './watcher.js';

const logger = createLogger('publications-bot', env.LOG_LEVEL);
const database = createDatabaseClient(env.DATABASE_URL);
const store = new WatcherStore(database);
const analyzer = new OllamaProvider({
  url: env.OLLAMA_URL,
  model: env.OLLAMA_MODEL,
  keepAlive: env.OLLAMA_KEEP_ALIVE,
  numCtx: env.OLLAMA_NUM_CTX,
  numPredict: env.OLLAMA_NUM_PREDICT,
  retries: env.OLLAMA_RETRIES,
  think: env.OLLAMA_THINK,
  timeoutMs: env.OLLAMA_TIMEOUT_MS,
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
);
runtime.runner = runner;
const scheduler = new PersistentScheduler(
  (now) => store.listDue('PUBLICATIONS', now),
  async (due) => {
    const entry = due as { id: string; chatConfig: { chatId: bigint } };
    await runner.execute(entry.id, entry.chatConfig.chatId, 'SCHEDULED');
  },
);
const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'Shutting down');
  await scheduler.stop();
  await bot.stop();
  await database.$disconnect();
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
scheduler.start();
await bot.start({ onStart: () => logger.info('Publications bot started') });
