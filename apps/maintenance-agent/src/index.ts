import {
  createLogger,
  errorMessage,
  PersistentScheduler,
  ProviderRequestLimiter,
} from '@watcher/core';
import {
  PostgresOllamaCoordinator,
  ResourceLeaseStore,
  TelegramOutboxStore,
  createDatabaseClient,
} from '@watcher/database';
import { parseAllowedUserIds, splitTelegramMessage } from '@watcher/telegram';
import { createMaintenanceApi } from './api.js';
import { AgentStatusService } from './agent-status.js';
import { env } from './env.js';
import { MaintenanceEngine } from './evaluation/engine.js';
import { MaintenanceScheduler } from './scheduler.js';
import {
  CapacityEvaluator,
  OllamaAnomalyEvaluator,
  OllamaRuntimeSampler,
  MaintenanceRuntimeMonitor,
  SystemMetricsSampler,
} from './runtime-monitor.js';
import { SecurityIntelligenceService } from './security/service.js';
import { SecurityEnricher } from './security/enrichment.js';
import { defaultTechnologyWatchlist } from './security/default-watchlist.js';
import { NvdClient } from './security/nvd.js';
import { OsvClient } from './security/osv.js';
import {
  renderCriticalSecurityAlert,
  renderDailySecurityDigest,
  renderWeeklySecurityReport,
  securityAlertDeduplicationKey,
} from './security/reporting.js';
import { TechnologyAdvisorySource } from './security/source.js';
import { TechnologyWatchService } from './security/technology-watch.js';
import { parseTechnologyWatchlist } from './security/watchlist.js';
import { SecurityWatchRunner } from './security/watch-runner.js';
import {
  announceChangelog,
  announceRelease,
  createMaintenanceBot,
  renderReport,
} from './telegram.js';

const logger = createLogger('maintenance-agent', env.LOG_LEVEL);
const database = createDatabaseClient(env.DATABASE_URL);
const resourceLeases = new ResourceLeaseStore(database);
const telegramOutbox = new TelegramOutboxStore(database);
const ollamaCoordinator = new PostgresOllamaCoordinator(database, logger);
const engine = new MaintenanceEngine(
  database,
  logger,
  env.MAINTENANCE_SELF_REVIEW_ENABLED,
);
const store = engine.store();
const allowedIds = parseAllowedUserIds(env.TELEGRAM_ALLOWED_USER_IDS);
const securityEnricher = new SecurityEnricher();
const security = new SecurityIntelligenceService(store, {
  enricher: securityEnricher,
  immediateAlertMinimumScore: env.MAINTENANCE_SECURITY_ALERT_MIN_SCORE,
  onImmediateAlert: async (item) => {
    const body = renderCriticalSecurityAlert(item);
    await telegramOutbox.enqueueMany(
      [...allowedIds].map((chatId) => ({
        kind: 'maintenance-report',
        deduplicationKey: securityAlertDeduplicationKey(item, chatId),
        chatId: BigInt(chatId),
        body,
      })),
    );
  },
});
if (env.MAINTENANCE_SECURITY_INTELLIGENCE_ENABLED) {
  const watchlist = env.MAINTENANCE_TECHNOLOGY_WATCHLIST_JSON
    ? parseTechnologyWatchlist(
        JSON.parse(env.MAINTENANCE_TECHNOLOGY_WATCHLIST_JSON) as unknown,
      )
    : defaultTechnologyWatchlist;
  const nvdLimiter = new ProviderRequestLimiter({
    providerKey: 'nvd',
    maxConcurrency: 1,
    minimumSpacingMs: env.NVD_API_KEY ? 750 : 6_500,
    sharedRateLimitBackoff: true,
  });
  const advisorySource = new TechnologyAdvisorySource(
    new OsvClient(),
    new NvdClient(fetch, env.NVD_API_KEY, () => new Date(), 7, nvdLimiter),
  );
  engine.setSecurityEvaluation(
    new SecurityWatchRunner(
      watchlist,
      new TechnologyWatchService(advisorySource),
      securityEnricher,
      security,
      logger,
    ),
  );
}
const systemMetrics = new SystemMetricsSampler(env.MAINTENANCE_NVIDIA_SMI_PATH);
const agentStatus = new AgentStatusService(
  store,
  env.MAINTENANCE_AGENT_STATUS_STALE_MINUTES * 60_000,
  env.MAINTENANCE_AGENT_STATUS_ERROR_LOOKBACK_MINUTES * 60_000,
);
const { bot } = createMaintenanceBot(
  env.MAINTENANCE_TELEGRAM_TOKEN,
  allowedIds,
  engine,
  store,
  logger,
  env.MAINTENANCE_CHANGELOG_PATH,
  systemMetrics,
  agentStatus,
);
const api = createMaintenanceApi(
  store,
  engine,
  env.MAINTENANCE_API_TOKEN,
  async () => {
    await database.$queryRaw`SELECT 1`;
  },
  logger,
  security,
);
const scheduler = new MaintenanceScheduler(
  engine,
  store,
  resourceLeases,
  {
    enabled: env.MAINTENANCE_ENABLED,
    tickMs: env.MAINTENANCE_SCHEDULER_INTERVAL_MS,
    healthMinutes: env.MAINTENANCE_HEALTH_INTERVAL_MINUTES,
    dailyMinutes: env.MAINTENANCE_ANALYSIS_INTERVAL_MINUTES,
    weeklyEnabled: env.MAINTENANCE_WEEKLY_ANALYSIS_ENABLED,
    weeklyMinutes: env.MAINTENANCE_WEEKLY_INTERVAL_MINUTES,
    jitterMaxSeconds: env.MAINTENANCE_JITTER_MAX_SECONDS,
  },
  async (type, findings, runId, securityReportItems) => {
    const important = findings.filter((finding) =>
      ['CRITICAL', 'HIGH', 'MEDIUM'].includes(finding.severity),
    );
    if (important.length === 0 && securityReportItems.length === 0) return;
    const maintenanceBody = important.length
      ? renderReport(`${type} maintenance report`, important)
      : undefined;
    const securityBodies = securityReportItems.length
      ? splitTelegramMessage(
          type === 'WEEKLY'
            ? renderWeeklySecurityReport(securityReportItems, {
                generatedAt: new Date(),
                maxLength: Number.MAX_SAFE_INTEGER,
              })
            : renderDailySecurityDigest(securityReportItems, {
                generatedAt: new Date(),
                maxLength: Number.MAX_SAFE_INTEGER,
              }),
        )
      : [];
    await telegramOutbox.enqueueMany(
      [...allowedIds].flatMap((chatId) => [
        ...(maintenanceBody
          ? [
              {
                kind: 'maintenance-report',
                deduplicationKey: `${runId}:maintenance:${chatId}`,
                chatId: BigInt(chatId),
                body: maintenanceBody,
              },
            ]
          : []),
        ...securityBodies.map((body, page) => ({
          kind: 'maintenance-report',
          deduplicationKey: `${runId}:security:${page}:${chatId}`,
          chatId: BigInt(chatId),
          body,
        })),
      ]),
    );
  },
  logger,
);
const reportDeliveryScheduler = new PersistentScheduler(
  (now) => telegramOutbox.claimDue(now, 10, undefined, ['maintenance-report']),
  async (due) => {
    const message = due as Awaited<
      ReturnType<typeof telegramOutbox.claimDue>
    >[number];
    if (!allowedIds.has(Number(message.chatId))) {
      await telegramOutbox.markFailed(
        message,
        'Maintenance report recipient is not allowed',
      );
      return;
    }
    try {
      const sent = await bot.api.sendMessage(
        message.chatId.toString(),
        message.body,
      );
      await telegramOutbox.markDelivered(message, String(sent.message_id));
    } catch (error) {
      const retryAt =
        message.attemptCount >= 6
          ? undefined
          : new Date(
              Date.now() +
                Math.min(60 * 60_000, 30_000 * 2 ** (message.attemptCount - 1)),
            );
      await telegramOutbox.markFailed(message, errorMessage(error), retryAt);
      logger.warn(
        { err: error, outboxMessageId: message.id, retryAt },
        'Maintenance report Telegram delivery failed',
      );
    }
  },
  30_000,
  logger,
);
const runtimeMonitor = new MaintenanceRuntimeMonitor(
  store,
  systemMetrics,
  new CapacityEvaluator(
    {
      CPU: env.MAINTENANCE_CPU_WARNING_PERCENT,
      memory: env.MAINTENANCE_MEMORY_WARNING_PERCENT,
      GPU: env.MAINTENANCE_GPU_WARNING_PERCENT,
    },
    env.MAINTENANCE_CAPACITY_SUSTAINED_SAMPLES,
    env.MAINTENANCE_CAPACITY_ALERT_COOLDOWN_MINUTES * 60_000,
  ),
  ollamaCoordinator,
  new OllamaRuntimeSampler(env.OLLAMA_URL),
  new OllamaAnomalyEvaluator({
    cpuAlertPercent: env.OLLAMA_CPU_ALERT_PERCENT,
    highUsageDurationMs: env.OLLAMA_HIGH_USAGE_DURATION_SECONDS * 1_000,
    imbalanceEnabled: env.OLLAMA_CPU_GPU_IMBALANCE_ENABLED,
    imbalanceDurationMs: env.OLLAMA_CPU_GPU_IMBALANCE_DURATION_SECONDS * 1_000,
    cpuGpuShareMarginPercent: env.OLLAMA_CPU_GPU_SHARE_MARGIN_PERCENT,
    gpuLowUtilPercent: env.OLLAMA_GPU_LOW_UTIL_PERCENT,
    requestTimeoutMs: env.OLLAMA_REQUEST_TIMEOUT_SECONDS * 1_000,
    queueAlertSize: env.OLLAMA_QUEUE_ALERT_SIZE,
    queueWaitAlertMs: env.OLLAMA_QUEUE_WAIT_ALERT_SECONDS * 1_000,
    cooldownMs: env.OLLAMA_ALERT_COOLDOWN_SECONDS * 1_000,
  }),
  env.MAINTENANCE_RESOURCE_MONITOR_INTERVAL_MS,
  async (message) => {
    await Promise.allSettled(
      [...allowedIds].map((chatId) => bot.api.sendMessage(chatId, message)),
    );
  },
  async (chatId, message) => {
    await bot.api.sendMessage(chatId.toString(), message);
  },
  logger,
);

let stopping = false;
let releasePollTimer: ReturnType<typeof setInterval> | undefined;
let releasePoll: Promise<void> | undefined;
const pollRelease = (): void => {
  if (releasePoll) return;
  releasePoll = announceRelease(
    bot,
    store,
    allowedIds,
    env.MAINTENANCE_RELEASE_PATH,
    logger,
  )
    .catch((error: unknown) =>
      logger.warn({ err: error }, 'Release poll failed'),
    )
    .finally(() => {
      releasePoll = undefined;
    });
};
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
    pollRelease();
    releasePollTimer = setInterval(pollRelease, 30_000);
  },
});
scheduler.start();
reportDeliveryScheduler.start();
if (env.MAINTENANCE_RESOURCE_MONITOR_ENABLED) runtimeMonitor.start();

const shutdown = async (signal: string): Promise<void> => {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'Shutting down maintenance agent');
  if (releasePollTimer) clearInterval(releasePollTimer);
  await releasePoll;
  await runtimeMonitor.stop();
  await scheduler.stop();
  await reportDeliveryScheduler.stop();
  if (bot.isRunning()) await bot.stop();
  await api.close();
  await database.$disconnect();
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
