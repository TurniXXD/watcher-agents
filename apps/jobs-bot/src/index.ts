import { ReadinessServer, createLogger } from '@watcher/core';
import { JobStore, createDatabaseClient } from '@watcher/database';
import {
  OpenAiCompatibleJobEvaluator,
  createJobSourceDefinitions,
} from '@watcher/jobs';
import { parseAllowedUserIds } from '@watcher/telegram';
import { createJobsBot, jobsBotCommands } from './bot.js';
import { env } from './env.js';
import { deliverJobDigest } from './notifications.js';
import { JobDiscoveryRunner } from './runner.js';

const logger = createLogger('jobs-bot', env.LOG_LEVEL);
const database = createDatabaseClient(env.DATABASE_URL);
const store = new JobStore(database);
const aiEvaluator = env.JOBS_AI_ENABLED
  ? new OpenAiCompatibleJobEvaluator({
      baseUrl: env.JOBS_AI_BASE_URL,
      model: env.JOBS_AI_MODEL,
      provider: env.JOBS_AI_BASE_URL.includes('11434')
        ? 'ollama'
        : 'openai-compatible',
      timeoutMs: env.JOBS_AI_TIMEOUT_MS,
      ...(env.JOBS_AI_API_KEY ? { apiKey: env.JOBS_AI_API_KEY } : {}),
    })
  : undefined;
const runner = new JobDiscoveryRunner(
  store,
  env.CANDIDATE_PROFILE,
  env.JOBS_DETAIL_REFRESH_HOURS,
  logger,
  createJobSourceDefinitions({
    greenhouseBoards: env.JOBS_GREENHOUSE_BOARDS,
    leverSites: env.JOBS_LEVER_SITES,
    ashbyBoards: env.JOBS_ASHBY_BOARDS,
    smartRecruitersCompanies: env.JOBS_SMARTRECRUITERS_COMPANIES,
    workableAccounts: env.JOBS_WORKABLE_ACCOUNTS,
    recruiteeCompanies: env.JOBS_RECRUITEE_COMPANIES,
    teamtailorDomains: env.JOBS_TEAMTAILOR_DOMAINS,
  }),
  aiEvaluator,
);
await runner.initialize();
await store.ensureSchedules(env.JOBS_TIMEZONE);

const allowedUserIds = parseAllowedUserIds(env.TELEGRAM_ALLOWED_USER_IDS);
const chatIds = [...allowedUserIds].map(BigInt);
const deliver = (
  recipientIds: readonly bigint[],
  alerts: Parameters<typeof deliverJobDigest>[0]['jobs'],
) =>
  deliverJobDigest({
    bot,
    chatIds: recipientIds,
    store,
    jobs: alerts,
    ...(env.JOBS_EMAIL_WEBHOOK_URL && env.JOBS_EMAIL_RECIPIENT
      ? {
          email: {
            url: env.JOBS_EMAIL_WEBHOOK_URL,
            recipient: env.JOBS_EMAIL_RECIPIENT,
            ...(env.JOBS_EMAIL_WEBHOOK_API_KEY
              ? { apiKey: env.JOBS_EMAIL_WEBHOOK_API_KEY }
              : {}),
          },
        }
      : {}),
  });

const bot = createJobsBot({
  token: env.JOBS_TELEGRAM_TOKEN,
  allowedUserIds,
  store,
  runner,
  onRunComplete: (chatId, alerts) => deliver([chatId], alerts),
  reportError: (error) =>
    logger.error({ err: error }, 'Telegram update failed'),
});

const readiness = new ReadinessServer(
  async () => void (await database.$queryRaw`SELECT 1`),
  logger,
);
await readiness.start(env.JOBS_HEALTH_PORT);

let schedulerActive: Promise<void> | undefined;
const schedulerTick = (): void => {
  if (schedulerActive) return;
  schedulerActive = (async () => {
    const due = await store.claimDueSchedule();
    if (!due) return;
    let status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'SKIPPED' = 'FAILED';
    try {
      const result = await runner.run({ trigger: 'SCHEDULED' });
      status = result.status;
      const delivered = await deliver(chatIds, result.alerts);
      if (
        result.status !== 'SKIPPED' &&
        result.runId !== 'dry-run' &&
        result.runId !== 'overlap-prevented'
      )
        await store.recordRunNotifications(result.runId, delivered);
    } catch (error) {
      logger.error(
        { err: error, schedule: due.scheduleKey },
        'Scheduled job discovery failed',
      );
    } finally {
      await store.completeSchedule(due.id, due.cron, due.timezone, status);
    }
  })()
    .catch((error) => logger.error({ err: error }, 'Job scheduler tick failed'))
    .finally(() => {
      schedulerActive = undefined;
    });
};
const scheduler = setInterval(schedulerTick, env.JOBS_SCHEDULER_INTERVAL_MS);
scheduler.unref();

await bot.api.setMyCommands([...jobsBotCommands]);

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'Shutting down');
  readiness.markApplicationStopping();
  clearInterval(scheduler);
  await schedulerActive;
  await bot.stop();
  await readiness.stop();
  await database.$disconnect();
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await bot.start({
  onStart: () => {
    readiness.markApplicationReady();
    logger.info({}, 'Jobs bot started');
  },
});
