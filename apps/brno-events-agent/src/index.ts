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

process.env.TZ = env.TZ;
const logger = createLogger('brno-events-agent', env.LOG_LEVEL);
const database = createDatabaseClient(env.DATABASE_URL);
const repository = new EventRepository(database);
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
);
let stopping = false;
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
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  await scheduler.stop();
  logger.info({ signal }, 'Shutting down Brno events agent');
  await api.close();
  await database.$disconnect();
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
