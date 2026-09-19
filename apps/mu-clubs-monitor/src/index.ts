import { PersistentScheduler, createLogger } from '@watcher/core';
import {
  BriefingWatcherHealthStore,
  AgentTelemetryStore,
  PostgresBriefingEventRepository,
  createDatabaseClient,
} from '@watcher/database';
import {
  CachedInstagramClient,
  InstagramPublicProvider,
} from '@watcher/sources/instagram';
import { createApi } from './api.js';
import { env } from './env.js';
import { MuClubsMonitor } from './monitor.js';
import { clubRegistry } from './registry.js';
import {
  InstagramActivitySource,
  WebsiteActivitySource,
} from './sources/index.js';
import { MuClubsStore, PostgresInstagramCache } from './store.js';

const logger = createLogger('mu-clubs-monitor', env.LOG_LEVEL);
const database = createDatabaseClient(env.DATABASE_URL);
const store = new MuClubsStore(database);
await store.seedRegistry(clubRegistry);
const instagram = new CachedInstagramClient(new InstagramPublicProvider(), {
  cache: new PostgresInstagramCache(database),
  cacheTtlMs: env.INSTAGRAM_CACHE_TTL_MINUTES * 60_000,
  minimumRequestIntervalMs: env.INSTAGRAM_MIN_REQUEST_INTERVAL_MS,
  maximumPostsPerFetch: env.INSTAGRAM_MAX_POSTS_PER_FETCH,
});
const monitor = new MuClubsMonitor(
  store,
  {
    WEBSITE: new WebsiteActivitySource(),
    LINKTREE: new WebsiteActivitySource(),
    INSTAGRAM: new InstagramActivitySource(instagram),
  },
  new PostgresBriefingEventRepository(database, logger),
  new BriefingWatcherHealthStore(database),
  env.MU_CLUBS_MONITOR_INTERVAL_MINUTES * 60_000,
  logger,
  new AgentTelemetryStore(database),
);
const api = createApi(
  store,
  monitor,
  env.MU_CLUBS_API_TOKEN,
  logger,
  async () => {
    await database.$queryRaw`SELECT 1`;
  },
);
let stopping = false;
const scheduler = new PersistentScheduler(
  (now) => store.listDueSchedules(now),
  async () => {
    await monitor.run('SCHEDULED');
  },
  env.MU_CLUBS_SCHEDULER_INTERVAL_MS,
  logger,
);
await api.listen({ host: env.MU_CLUBS_HOST, port: env.MU_CLUBS_PORT });
logger.info(
  { host: env.MU_CLUBS_HOST, port: env.MU_CLUBS_PORT },
  'MU Clubs monitor started',
);
scheduler.start();

const shutdown = async (signal: string): Promise<void> => {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'Shutting down MU Clubs monitor');
  await scheduler.stop();
  await api.close();
  await database.$disconnect();
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
