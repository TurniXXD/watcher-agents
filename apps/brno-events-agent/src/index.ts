import { PersistentScheduler, createLogger } from '@watcher/core';
import {
  AgentTelemetryStore,
  BriefingWatcherHealthStore,
  PostgresBriefingEventRepository,
  createDatabaseClient,
} from '@watcher/database';
import { createApi } from './api/server.js';
import { env, sourceSettings } from './env.js';
import { EventRepository } from './repositories/event-repository.js';
import { EventRunner } from './services/runner.js';
import { BriefingBrnoEventPublisher } from './services/briefing-publisher.js';
import { createSources } from './sources/registry.js';
import { ContentCmsClient } from './cms/client.js';
import { CmsOutboxRepository } from './cms/outbox-repository.js';
import { CmsSyncService } from './cms/sync.js';

process.env.TZ = env.TZ;
const logger = createLogger('brno-events-agent', env.LOG_LEVEL);
const database = createDatabaseClient(env.DATABASE_URL);
const cmsOutbox =
  env.CONTENT_CMS_URL && env.CONTENT_CMS_INGEST_TOKEN
    ? new CmsOutboxRepository(database)
    : undefined;
const cmsSync =
  cmsOutbox && env.CONTENT_CMS_URL && env.CONTENT_CMS_INGEST_TOKEN
    ? new CmsSyncService(
        cmsOutbox,
        new ContentCmsClient({
          baseUrl: env.CONTENT_CMS_URL,
          token: env.CONTENT_CMS_INGEST_TOKEN,
          timeoutMs: env.CONTENT_CMS_TIMEOUT_MS,
        }),
        logger,
        {
          batchSize: env.CONTENT_CMS_SYNC_BATCH_SIZE,
          maxAttempts: env.CONTENT_CMS_SYNC_MAX_ATTEMPTS,
        },
      )
    : undefined;
const repository = new EventRepository(database, cmsOutbox);
const runner = new EventRunner(
  repository,
  createSources(sourceSettings),
  logger,
  new BriefingBrnoEventPublisher(
    new PostgresBriefingEventRepository(database, logger),
  ),
  new AgentTelemetryStore(database),
  new BriefingWatcherHealthStore(database),
);
const api = createApi(
  repository,
  runner,
  env.BRNO_EVENTS_API_TOKEN,
  async () => {
    await database.$queryRaw`SELECT 1`;
  },
  logger,
  cmsOutbox && cmsSync ? { outbox: cmsOutbox, sync: cmsSync } : undefined,
);
let stopping = false;
let cmsTimer: NodeJS.Timeout | undefined;
let cmsFlush: Promise<unknown> = Promise.resolve();
const scheduleCmsSync = () => {
  if (!cmsSync || stopping) return;
  cmsTimer = setTimeout(() => {
    cmsFlush = cmsSync
      .flush()
      .catch((error: unknown) =>
        logger.warn({ err: error }, 'Brno events CMS sync loop failed'),
      )
      .finally(scheduleCmsSync);
  }, env.CONTENT_CMS_SYNC_INTERVAL_MS);
  cmsTimer.unref();
};
const scheduler = new PersistentScheduler(
  async (now) => {
    if (await repository.scheduledRunsEnabled()) {
      return runner
        .dueSourceIds(await repository.latestRuns(), now)
        .map((id) => ({ id }));
    }
    return [];
  },
  async ({ id }) => {
    await runner.runScheduledSource(id);
  },
  env.BRNO_EVENTS_SCHEDULER_INTERVAL_MS,
  logger,
);
await api.listen({ host: env.BRNO_EVENTS_HOST, port: env.BRNO_EVENTS_PORT });
logger.info(
  { host: env.BRNO_EVENTS_HOST, port: env.BRNO_EVENTS_PORT },
  'Brno events agent started',
);
scheduler.start();
if (cmsSync) {
  logger.info(
    { intervalMs: env.CONTENT_CMS_SYNC_INTERVAL_MS },
    'Brno events CMS sync enabled',
  );
  scheduleCmsSync();
}
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  await scheduler.stop();
  if (cmsTimer) clearTimeout(cmsTimer);
  await cmsFlush;
  logger.info({ signal }, 'Shutting down Brno events agent');
  await api.close();
  await database.$disconnect();
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
