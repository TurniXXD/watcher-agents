import { createLogger, ProviderRequestLimiter } from '@watcher/core';
import { createDatabaseClient, OsintStore } from '@watcher/database';
import { OllamaProvider } from '@watcher/llm';
import { parseAllowedUserIds } from '@watcher/telegram';
import { createOsintBot } from './bot.js';
import {
  createAresCollector,
  createAresRegisterCollector,
} from './collectors/ares.js';
import {
  createDnsCollector,
  createWebsiteCollector,
} from './collectors/domain.js';
import type { Collector } from './collectors/types.js';
import { env } from './env.js';
import { OsintService } from './service.js';

const logger = createLogger('osint-bot', env.LOG_LEVEL);
const database = createDatabaseClient(env.DATABASE_URL);
const store = new OsintStore(database);
const aresLimiter = new ProviderRequestLimiter({
  providerKey: 'ARES',
  maxConcurrency: 1,
  minimumSpacingMs: 600,
  sharedRateLimitBackoff: true,
});
const paceAres = (collector: Collector): Collector => ({
  ...collector,
  collect: (selector, signal) =>
    aresLimiter.run(() => collector.collect(selector, signal)),
});
const service = new OsintService(
  store,
  [
    paceAres(createAresCollector()),
    paceAres(createAresRegisterCollector()),
    createWebsiteCollector(),
    createDnsCollector(),
  ],
  logger,
  env.OSINT_MAX_COLLECTORS,
);
const llm =
  env.OLLAMA_URL && env.OLLAMA_MODEL
    ? new OllamaProvider({
        url: env.OLLAMA_URL,
        model: env.OLLAMA_MODEL,
        retries: 1,
        timeoutMs: 45_000,
      })
    : undefined;
const bot = createOsintBot(
  env.OSINT_TELEGRAM_TOKEN,
  parseAllowedUserIds(env.TELEGRAM_ALLOWED_USER_IDS),
  store,
  service,
  llm,
);

await store.recoverStaleRuns();

let polling = false;
let pollJob: Promise<void> | undefined;
const interval = setInterval(() => {
  if (polling) return;
  polling = true;
  pollJob = (async () => {
    try {
      const due = await store.claimDueWatches();
      for (const watch of due) {
        try {
          const result = await service.run(
            watch.investigation.userId,
            watch.investigationId,
          );
          if (result.newEvidence > 0) {
            await bot.api.sendMessage(
              watch.investigation.chatId,
              `🔎 Investigation ${watch.investigationId}: ${result.newEvidence} nových veřejných důkazů. /investigation ${watch.investigationId}`,
            );
          }
        } catch (error) {
          logger.error(
            { err: error, investigationId: watch.investigationId },
            'OSINT watch failed',
          );
        }
      }
    } catch (error) {
      logger.error({ err: error }, 'OSINT watch polling failed');
    } finally {
      polling = false;
    }
  })();
}, env.OSINT_WATCH_POLL_MINUTES * 60_000);

let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'Shutting down OSINT bot');
  clearInterval(interval);
  service.stop();
  await bot.stop();
  await pollJob;
  await database.$disconnect();
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
await bot.start({ onStart: () => logger.info({}, 'OSINT bot started') });
