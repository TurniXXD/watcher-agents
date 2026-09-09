import { createLogger } from '@watcher/core';
import { createDatabaseClient } from '@watcher/database';
import { parseAllowedUserIds } from '@watcher/telegram';
import { createMaintenanceApi } from './api.js';
import { env } from './env.js';
import { MaintenanceEngine } from './evaluation/engine.js';
import { MaintenanceScheduler } from './scheduler.js';
import {
  announceChangelog,
  createMaintenanceBot,
  renderReport,
} from './telegram.js';

const logger = createLogger('maintenance-agent', env.LOG_LEVEL);
const database = createDatabaseClient(env.DATABASE_URL);
const engine = new MaintenanceEngine(
  database,
  logger,
  env.MAINTENANCE_SELF_REVIEW_ENABLED,
);
const store = engine.store();
const allowedIds = parseAllowedUserIds(env.TELEGRAM_ALLOWED_USER_IDS);
const { bot } = createMaintenanceBot(
  env.MAINTENANCE_TELEGRAM_TOKEN,
  allowedIds,
  engine,
  store,
  logger,
  env.MAINTENANCE_CHANGELOG_PATH,
);
const api = createMaintenanceApi(
  store,
  engine,
  env.MAINTENANCE_API_TOKEN,
  async () => {
    await database.$queryRaw`SELECT 1`;
  },
  logger,
);
const scheduler = new MaintenanceScheduler(
  engine,
  store,
  {
    enabled: env.MAINTENANCE_ENABLED,
    tickMs: env.MAINTENANCE_SCHEDULER_INTERVAL_MS,
    healthMinutes: env.MAINTENANCE_HEALTH_INTERVAL_MINUTES,
    dailyMinutes: env.MAINTENANCE_ANALYSIS_INTERVAL_MINUTES,
    weeklyEnabled: env.MAINTENANCE_WEEKLY_ANALYSIS_ENABLED,
    weeklyMinutes: env.MAINTENANCE_WEEKLY_INTERVAL_MINUTES,
    jitterMaxSeconds: env.MAINTENANCE_JITTER_MAX_SECONDS,
  },
  async (type, findings) => {
    const important = findings.filter((finding) =>
      ['CRITICAL', 'HIGH', 'MEDIUM'].includes(finding.severity),
    );
    if (important.length === 0) return;
    await Promise.allSettled(
      [...allowedIds].map((chatId) =>
        bot.api.sendMessage(
          chatId,
          renderReport(`${type} maintenance report`, important),
        ),
      ),
    );
  },
  logger,
);

let stopping = false;
await api.listen({ host: env.MAINTENANCE_HOST, port: env.MAINTENANCE_PORT });
void bot.start({
  onStart: async () => {
    logger.info(
      { host: env.MAINTENANCE_HOST, port: env.MAINTENANCE_PORT },
      'Maintenance agent started',
    );
    await announceChangelog(
      bot,
      store,
      allowedIds,
      env.MAINTENANCE_CHANGELOG_PATH,
      logger,
    );
  },
});
scheduler.start();

const shutdown = async (signal: string): Promise<void> => {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'Shutting down maintenance agent');
  await scheduler.stop();
  await bot.stop();
  await api.close();
  await database.$disconnect();
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
