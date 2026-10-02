import { createLogger, ProviderRequestLimiter } from '@watcher/core';
import { createDatabaseClient, OsintStore } from '@watcher/database';
import { OllamaProvider } from '@watcher/llm';
import { parseAllowedUserIds } from '@watcher/telegram';
import { createOsintBot, osintBotCommands } from './bot.js';
import {
  createAresCollector,
  createAresInsolvencyCollector,
  createAresNameCollector,
  createAresRegisterCollector,
} from './collectors/ares.js';
import {
  createBitcoinCollector,
  createEthereumCollector,
} from './collectors/blockchain.js';
import { createContractRegistryCollector } from './collectors/contracts.js';
import {
  createCertificateTransparencyCollector,
  createWaybackCollector,
} from './collectors/domain-history.js';
import {
  createCrossrefCollector,
  createGithubCollector,
  createOrcidCollector,
  createRedditCollector,
  createWikipediaCollector,
} from './collectors/identity.js';
import {
  createPublicEmailEvidenceCollector,
  createPublicProfileMetadataCollector,
} from './collectors/public-profile.js';
import {
  createDnsCollector,
  createWebsiteCollector,
} from './collectors/domain.js';
import type { Collector } from './collectors/types.js';
import { createRuianAddressCollector } from './collectors/ruian.js';
import {
  createCuzkAddressPlaceCollector,
  createCuzkBuildingCollector,
  createCuzkCadastralAreaCollector,
  createCuzkParcelCollector,
} from './collectors/cuzk-property.js';
import { createRdapCollector } from './collectors/rdap.js';
import { env } from './env.js';
import { createOsintHealthServer } from './health.js';
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
const cuzkLimiter = new ProviderRequestLimiter({
  providerKey: 'CUZK',
  maxConcurrency: 1,
  minimumSpacingMs: 500,
  sharedRateLimitBackoff: true,
});
const paceAres = (collector: Collector): Collector => ({
  ...collector,
  collect: (selector, signal) =>
    aresLimiter.run(() => collector.collect(selector, signal)),
});
const paceCuzk = (collector: Collector): Collector => ({
  ...collector,
  collect: (selector, signal) =>
    cuzkLimiter.run(() => collector.collect(selector, signal)),
});
const service = new OsintService(
  store,
  [
    paceAres(createAresNameCollector()),
    paceAres(createAresCollector()),
    paceAres(createAresRegisterCollector()),
    paceAres(createAresInsolvencyCollector()),
    createContractRegistryCollector(),
    createRuianAddressCollector(),
    paceCuzk(createCuzkAddressPlaceCollector()),
    paceCuzk(createCuzkParcelCollector()),
    paceCuzk(createCuzkBuildingCollector()),
    paceCuzk(createCuzkCadastralAreaCollector()),
    createWebsiteCollector(),
    createDnsCollector(),
    createRdapCollector(),
    createCertificateTransparencyCollector(),
    createWaybackCollector(),
    createWikipediaCollector(),
    createGithubCollector(),
    createRedditCollector(),
    createOrcidCollector(),
    createCrossrefCollector(),
    createPublicProfileMetadataCollector(),
    createPublicEmailEvidenceCollector(),
    createBitcoinCollector(),
    createEthereumCollector(),
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

let ready = false;
const healthServer = createOsintHealthServer(() => ready);
await new Promise<void>((resolve, reject) => {
  healthServer.once('error', reject);
  healthServer.listen(env.OSINT_HEALTH_PORT, '127.0.0.1', () => {
    healthServer.off('error', reject);
    resolve();
  });
});

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
  ready = false;
  logger.info({ signal }, 'Shutting down OSINT bot');
  clearInterval(interval);
  service.stop();
  await bot.stop();
  await pollJob;
  await new Promise<void>((resolve, reject) => {
    healthServer.close((error) => (error ? reject(error) : resolve()));
  });
  await database.$disconnect();
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
await bot.api.setMyCommands([...osintBotCommands]);
await bot.start({
  onStart: () => {
    ready = true;
    logger.info({}, 'OSINT bot started');
  },
});
