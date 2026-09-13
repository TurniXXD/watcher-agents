import { ReadinessServer, checkOllamaReady, createLogger } from '@watcher/core';
import {
  AgentScheduleStore,
  AgentTelemetryStore,
  BriefingDeliveryStore,
  BriefingConfigurationStore,
  BriefingRunStore,
  BriefingScheduleStore,
  BriefingStoryClusterStore,
  BriefingStoryStore,
  BriefingWatcherHealthStore,
  CalendarIntegrationStore,
  PostgresBriefingEventRepository,
  PostgresOllamaCoordinator,
  NewsConfigurationStore,
  createDatabaseClient,
  ResourceLeaseStore,
} from '@watcher/database';
import { OllamaEmbeddingProvider, OllamaProvider } from '@watcher/llm';
import { parseAllowedUserIds } from '@watcher/telegram';
import { InputFile } from 'grammy';
import { createBriefingBot, type CalendarCommands } from './bot.js';
import { AgentTriggerService } from './agent-triggers.js';
import {
  CalendarCredentialCipher,
  GoogleCalendarOAuth,
} from './calendar-oauth.js';
import { calendarDayWindow, GoogleCalendarProvider } from './calendar.js';
import { BriefingCoordinator } from './briefing-coordinator.js';
import { BriefingScheduler } from './briefing-scheduler.js';
import { BriefingDeliveryService } from './delivery.js';
import { env } from './env.js';
import { OAuthCallbackServer } from './oauth-callback-server.js';
import { PiperLocalTtsProvider } from './piper-tts.js';
import { BriefingScriptGenerator } from './script-generator.js';
import { StoryEngine } from './story-engine.js';
import { SemanticStoryMatcher } from './semantic-story-matcher.js';
import { GrammyBriefingTransport } from './telegram-transport.js';
import { voicePreviewText } from './voice-registry.js';
import {
  OpenMeteoGeocodingProvider,
  OpenMeteoWeatherProvider,
} from './weather.js';

const logger = createLogger('briefing-bot', env.LOG_LEVEL);
const allowedUserIds = parseAllowedUserIds(env.TELEGRAM_ALLOWED_USER_IDS);
logger.info(
  {
    logLevel: env.LOG_LEVEL,
    allowedUserCount: allowedUserIds.size,
    calendarConfigured: Boolean(env.GOOGLE_CALENDAR_CLIENT_ID),
    ollamaModel: env.OLLAMA_MODEL,
    schedulerIntervalMs: env.BRIEFING_SCHEDULER_INTERVAL_MS,
    piperKeepTemporaryFiles: env.PIPER_KEEP_TEMP === 'true',
  },
  'Briefing bot configuration loaded',
);
const database = createDatabaseClient(env.DATABASE_URL);
const ollamaCoordinator = new PostgresOllamaCoordinator(database, logger);
const configuration = new BriefingConfigurationStore(database);
const calendarStore = new CalendarIntegrationStore(database);
const resourceLeases = new ResourceLeaseStore(database);
const briefingRuns = new BriefingRunStore(database);
const briefingSchedules = new BriefingScheduleStore(database);
const briefingStoryStates = new BriefingStoryStore(database);
const briefingStoryClusters = new BriefingStoryClusterStore(database);
const briefingWatcherHealth = new BriefingWatcherHealthStore(database);
const briefingEvents = new PostgresBriefingEventRepository(database, logger);
const newsConfiguration = new NewsConfigurationStore(database, logger);
const briefingDeliveries = new BriefingDeliveryStore(database);
const agentSchedules = new AgentScheduleStore(database);
const agentTriggers = new AgentTriggerService({
  watchers: agentSchedules,
  ...(env.BRNO_EVENTS_API_TOKEN
    ? {
        brnoEvents: {
          baseUrl: env.BRIEFING_BRNO_EVENTS_URL,
          token: env.BRNO_EVENTS_API_TOKEN,
        },
      }
    : {}),
  ...(env.MU_CLUBS_API_TOKEN
    ? {
        muClubs: {
          baseUrl: env.BRIEFING_MU_CLUBS_URL,
          token: env.MU_CLUBS_API_TOKEN,
        },
      }
    : {}),
  timeoutMs: env.BRIEFING_AGENT_TRIGGER_TIMEOUT_MS,
});
const tts = new PiperLocalTtsProvider({
  dataDirectory: env.PIPER_DATA_DIR,
  pythonExecutable: env.PIPER_PYTHON_PATH,
  ffmpegExecutable: env.FFMPEG_PATH,
  ffprobeExecutable: env.FFPROBE_PATH,
  keepTemporaryFiles: env.PIPER_KEEP_TEMP === 'true',
  logger,
});
const readiness = new ReadinessServer(async () => {
  await database.$queryRaw`SELECT 1`;
  await checkOllamaReady(env.OLLAMA_URL);
  await tts.checkReady();
}, logger);
const calendarConfigured = Boolean(env.GOOGLE_CALENDAR_CLIENT_ID);
const calendarOAuth = calendarConfigured
  ? new GoogleCalendarOAuth(
      {
        clientId: env.GOOGLE_CALENDAR_CLIENT_ID!,
        clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET!,
        redirectUri: env.GOOGLE_CALENDAR_REDIRECT_URI!,
      },
      calendarStore,
      new CalendarCredentialCipher(env.CALENDAR_TOKEN_ENCRYPTION_KEY!),
    )
  : undefined;
const calendarProvider = calendarOAuth
  ? new GoogleCalendarProvider(calendarOAuth, calendarStore)
  : undefined;
const calendarCommands: CalendarCommands | undefined =
  calendarOAuth && calendarProvider
    ? {
        authorizationUrl: (telegramChatId) =>
          calendarOAuth.authorizationUrl(telegramChatId),
        disconnect: (telegramChatId) =>
          calendarStore.disconnect(telegramChatId),
        status: async (telegramChatId) => ({
          connected:
            (await calendarStore.get(telegramChatId))?.connected ?? false,
        }),
        eventsToday: (telegramChatId, timezone) =>
          calendarProvider.listEvents(
            telegramChatId,
            {
              ...calendarDayWindow(new Date(), timezone),
              timezone,
            },
            AbortSignal.timeout(15_000),
          ),
      }
    : undefined;
const runtime: { coordinator?: BriefingCoordinator } = {};
const bot = createBriefingBot(
  env.BRIEFING_TELEGRAM_TOKEN,
  allowedUserIds,
  configuration,
  (error) => logger.error({ err: error }, 'Telegram update failed'),
  async (context, voice) => {
    const generated = await resourceLeases.withExclusiveLease(
      'HEAVY_LOCAL_MODEL',
      () =>
        tts.generateSpeech({ text: voicePreviewText, language: 'en', voice }),
    );
    await context.replyWithVoice(
      new InputFile(generated.audio, generated.fileName),
      { caption: `${voice} preview` },
    );
  },
  new OpenMeteoGeocodingProvider(),
  calendarCommands,
  (telegramChatId, type, progress) => {
    if (!runtime.coordinator) throw new Error('Briefing runner is not ready');
    return runtime.coordinator.generate(
      telegramChatId,
      type,
      undefined,
      progress,
    );
  },
  logger,
  agentSchedules,
  agentTriggers,
);
const scriptModel = new OllamaProvider({
  url: env.OLLAMA_URL,
  model: env.OLLAMA_MODEL,
  keepAlive: env.OLLAMA_KEEP_ALIVE,
  numCtx: env.OLLAMA_NUM_CTX,
  retries: env.OLLAMA_RETRIES,
  think: env.OLLAMA_THINK,
  timeoutMs: env.OLLAMA_TIMEOUT_MS,
  caller: 'briefing-bot',
  priority: 'high',
  coordinator: ollamaCoordinator,
});
const semanticMatcher = env.BRIEFING_EMBEDDING_MODEL
  ? new SemanticStoryMatcher(
      env.BRIEFING_EMBEDDING_MODEL,
      new OllamaEmbeddingProvider({
        url: env.OLLAMA_URL,
        model: env.BRIEFING_EMBEDDING_MODEL,
        keepAlive: env.OLLAMA_KEEP_ALIVE,
        timeoutMs: env.OLLAMA_TIMEOUT_MS,
        caller: 'briefing-bot',
        priority: 'high',
        coordinator: ollamaCoordinator,
      }),
      briefingStoryClusters,
      logger,
      env.BRIEFING_EMBEDDING_MIN_SIMILARITY,
      env.BRIEFING_EMBEDDING_WINDOW_HOURS,
    )
  : undefined;
const delivery = new BriefingDeliveryService(
  briefingDeliveries,
  new GrammyBriefingTransport(bot.api),
  {
    maxAttempts: env.BRIEFING_TELEGRAM_ATTEMPTS,
    baseDelayMs: env.BRIEFING_TELEGRAM_RETRY_BASE_MS,
    logger,
  },
);
runtime.coordinator = new BriefingCoordinator({
  configuration,
  runs: briefingRuns,
  storyStates: briefingStoryStates,
  storyEngine: new StoryEngine(
    briefingEvents,
    briefingStoryStates,
    briefingStoryClusters,
    semanticMatcher,
    logger,
    newsConfiguration,
  ),
  scripts: new BriefingScriptGenerator(scriptModel),
  tts,
  delivery,
  resources: resourceLeases,
  weather: new OpenMeteoWeatherProvider(),
  watcherHealth: briefingWatcherHealth,
  watcherTrigger: agentTriggers,
  telemetry: new AgentTelemetryStore(database),
  ...(calendarProvider ? { calendar: calendarProvider } : {}),
  logger,
  ttsAttempts: env.BRIEFING_TTS_ATTEMPTS,
  freshness: {
    maximumAgeMs: env.BRIEFING_FRESHNESS_MAX_AGE_MINUTES * 60_000,
    warningIntervalMs: env.BRIEFING_FRESHNESS_WAIT_TIMEOUT_MINUTES * 60_000,
    pollIntervalMs: env.BRIEFING_FRESHNESS_POLL_INTERVAL_MS,
  },
});
const scheduler = new BriefingScheduler(
  briefingSchedules,
  async ({ telegramChatId, scheduledFor, scheduleKey, periodHours }) => {
    try {
      await runtime.coordinator!.generate(
        telegramChatId,
        'SCHEDULED',
        scheduledFor,
        undefined,
        {
          scheduleKey,
          ...(periodHours === undefined ? {} : { periodHours }),
        },
      );
    } catch (error) {
      try {
        await bot.api.sendMessage(
          telegramChatId.toString(),
          '⚠️ Scheduled morning briefing failed. Check briefing-bot logs; the next scheduled run remains enabled.',
        );
      } catch (notificationError) {
        logger.error(
          { err: notificationError, telegramChatId: telegramChatId.toString() },
          'Failed to notify user about scheduled briefing failure',
        );
      }
      throw error;
    }
  },
  env.BRIEFING_SCHEDULER_INTERVAL_MS,
  (error) => logger.error({ err: error }, 'Briefing scheduler failed'),
  logger,
);
const oauthServer = calendarOAuth
  ? new OAuthCallbackServer(
      calendarOAuth,
      async (telegramChatId) => {
        let current = await configuration.ensure(telegramChatId);
        if (current.onboarding.currentStep === 'GOOGLE_CALENDAR') {
          current = await configuration.setOnboardingStep(
            telegramChatId,
            'SUBSCRIPTIONS',
          );
        }
        await bot.api.sendMessage(
          telegramChatId.toString(),
          current.onboarding.currentStep === 'SUBSCRIPTIONS'
            ? 'Google Calendar connected. Continue setup with /start.'
            : 'Google Calendar connected.',
        );
      },
      env.GOOGLE_CALENDAR_REDIRECT_URI!,
      logger,
    )
  : undefined;

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'Shutting down');
  readiness.markApplicationStopping();
  await scheduler.stop();
  await oauthServer?.stop();
  await bot.stop();
  await readiness.stop();
  await database.$disconnect();
};

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
await oauthServer?.start(
  env.CALENDAR_OAUTH_LISTEN_PORT,
  env.CALENDAR_OAUTH_LISTEN_HOST,
);
scheduler.start();
await readiness.start();
await bot.start({
  onStart: () => {
    readiness.markApplicationReady();
    logger.info('Briefing bot started');
  },
});
