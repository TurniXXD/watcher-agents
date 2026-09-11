import { createLogger } from '@watcher/core';
import { AgentTelemetryStore, createDatabaseClient } from '@watcher/database';
import { createApi } from './api/server.js';
import { env, sourceSettings } from './env.js';
import { EventRepository } from './repositories/event-repository.js';
import { EventRunner } from './services/runner.js';
import { createSources } from './sources/registry.js';

process.env.TZ = env.TZ;
const logger = createLogger('brno-events-agent', env.LOG_LEVEL);
const database = createDatabaseClient(env.DATABASE_URL);
const repository = new EventRepository(database);
const runner = new EventRunner(
  repository,
  createSources(sourceSettings),
  logger,
  undefined,
  new AgentTelemetryStore(database),
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
let activeTick: Promise<void> | undefined;
const tick = (): Promise<void> => {
  if (stopping) return Promise.resolve();
  if (activeTick) return activeTick;
  activeTick = (async () => {
    await runner.runDue(await repository.latestRuns());
  })().finally(() => {
    activeTick = undefined;
  });
  return activeTick;
};
const timer = setInterval(
  () =>
    void tick().catch((error) =>
      logger.error({ err: error }, 'Brno events scheduler failed'),
    ),
  env.BRNO_EVENTS_SCHEDULER_INTERVAL_MS,
);
timer.unref();
await api.listen({ host: env.BRNO_EVENTS_HOST, port: env.BRNO_EVENTS_PORT });
logger.info(
  { host: env.BRNO_EVENTS_HOST, port: env.BRNO_EVENTS_PORT },
  'Brno events agent started',
);
void tick().catch((error) =>
  logger.error({ err: error }, 'Initial Brno events run failed'),
);
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  logger.info({ signal }, 'Shutting down Brno events agent');
  await api.close();
  await activeTick;
  await database.$disconnect();
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
