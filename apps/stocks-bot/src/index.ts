import { PersistentScheduler, createLogger } from '@watcher/core';
import { createDatabaseClient, WatcherStore } from '@watcher/database';
import { OllamaProvider } from '@watcher/llm';
import { SecEdgarSource } from '@watcher/stock-sources';
import { parseAllowedUserIds } from '@watcher/telegram';
import { createStocksBot } from './bot.js';
import { env } from './env.js';
import { createStocksRunner } from './watcher.js';

const logger = createLogger('stocks-bot', env.LOG_LEVEL);
const database = createDatabaseClient(env.DATABASE_URL);
const store = new WatcherStore(database);
const sec = new SecEdgarSource(env.SEC_USER_AGENT);
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
const runtime: { runner?: ReturnType<typeof createStocksRunner> } = {};
const bot = createStocksBot(
  env.STOCKS_TELEGRAM_TOKEN,
  parseAllowedUserIds(env.TELEGRAM_ALLOWED_USER_IDS),
  store,
  (configId, chatId) => {
    if (!runtime.runner) throw new Error('Stocks runner is not ready');
    return runtime.runner.execute(configId, chatId, 'MANUAL');
  },
  (symbol) => sec.lookupCompany(symbol),
  env.DEFAULT_TIMEZONE,
  (error) => logger.error({ err: error }, 'Telegram update failed'),
);
const runner = createStocksRunner(
  store,
  analyzer,
  bot.api,
  sec,
  env.OLLAMA_MAX_ITEMS_PER_RUN,
);
runtime.runner = runner;
const scheduler = new PersistentScheduler(
  (now) => store.listDue('STOCKS', now),
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
await bot.start({ onStart: () => logger.info('Stocks bot started') });
