import { createLogger, ReadinessServer } from '@watcher/core';
import {
  CalendarIntegrationStore,
  createDatabaseClient,
  PostgresOllamaCoordinator,
  SocialsStore,
} from '@watcher/database';
import {
  CalendarCredentialCipher,
  GoogleCalendarOAuth,
  GoogleCalendarProvider,
  OAuthCallbackServer,
} from '@watcher/google-calendar';
import { OllamaProvider } from '@watcher/llm';
import { parseAllowedUserIds } from '@watcher/telegram';
import {
  GoogleSheetsNetworkRepository,
  NetworkAiService,
  OllamaBusinessCardParser,
  type NetworkBotDependencies,
} from '@watcher/contact-network';
import { createNetworkingBot, networkingBotCommands } from './bot.js';
import { env } from './env.js';
import { NetworkingScheduler } from './scheduler.js';
import { NetworkingService } from './service.js';

const logger = createLogger('networking-bot', env.LOG_LEVEL);
const database = createDatabaseClient(env.DATABASE_URL);
const store = new SocialsStore(database);
const calendarStore = new CalendarIntegrationStore(database);
const coordinator = new PostgresOllamaCoordinator(database, logger);
const llm =
  env.OLLAMA_URL && env.OLLAMA_MODEL
    ? new OllamaProvider({
        url: env.OLLAMA_URL,
        model: env.OLLAMA_MODEL,
        retries: 1,
        timeoutMs: env.OLLAMA_TIMEOUT_MS,
        numPredict: 900,
        think: false,
        caller: 'networking-bot',
        priority: 'normal',
        coordinator,
      })
    : undefined;
const contacts: NetworkBotDependencies | undefined =
  env.GOOGLE_SHEETS_SPREADSHEET_ID &&
  env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
  env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
    ? {
        repository: new GoogleSheetsNetworkRepository({
          spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID,
          range: env.GOOGLE_SHEETS_NETWORK_RANGE,
          serviceAccountEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
          serviceAccountPrivateKey: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
        }),
        ai: new NetworkAiService(llm),
        ...(env.OLLAMA_URL && env.NETWORK_OLLAMA_VISION_MODEL
          ? {
              cardParser: new OllamaBusinessCardParser(
                env.OLLAMA_URL,
                env.NETWORK_OLLAMA_VISION_MODEL,
                env.OLLAMA_TIMEOUT_MS,
              ),
            }
          : {}),
        telegramToken: env.NETWORKING_TELEGRAM_TOKEN,
        logger,
      }
    : undefined;
const calendarConfigured = Boolean(env.NETWORKING_GOOGLE_CALENDAR_CLIENT_ID);
const calendarOAuth = calendarConfigured
  ? new GoogleCalendarOAuth(
      {
        clientId: env.NETWORKING_GOOGLE_CALENDAR_CLIENT_ID!,
        clientSecret: env.NETWORKING_GOOGLE_CALENDAR_CLIENT_SECRET!,
        redirectUri: env.NETWORKING_GOOGLE_CALENDAR_REDIRECT_URI!,
        scopes: ['https://www.googleapis.com/auth/calendar.events'],
        enableBriefingCalendar: false,
      },
      calendarStore,
      new CalendarCredentialCipher(env.CALENDAR_TOKEN_ENCRYPTION_KEY!),
    )
  : undefined;
const calendarProvider = calendarOAuth
  ? new GoogleCalendarProvider(calendarOAuth, calendarStore)
  : undefined;
const service = new NetworkingService(
  store,
  env.NETWORKING_TIMEZONE,
  calendarProvider,
);
const bot = createNetworkingBot({
  token: env.NETWORKING_TELEGRAM_TOKEN,
  allowedIds: parseAllowedUserIds(env.TELEGRAM_ALLOWED_USER_IDS),
  store,
  service,
  timezone: env.NETWORKING_TIMEZONE,
  ...(contacts ? { contacts } : {}),
  ...(calendarOAuth
    ? {
        calendar: {
          authorizationUrl: (telegramChatId: bigint) =>
            calendarOAuth.authorizationUrl(telegramChatId),
          status: async (telegramChatId: bigint) => ({
            connected:
              (await calendarStore.get(telegramChatId))?.connected ?? false,
          }),
        },
      }
    : {}),
  reportError: (error) =>
    logger.error({ err: error }, 'Networking Telegram update failed'),
});
const scheduler = new NetworkingScheduler({
  store,
  intervalMs: env.NETWORKING_SCHEDULER_INTERVAL_MS,
  defaultTimezone: env.NETWORKING_TIMEZONE,
  transport: {
    send: async (chatId, text) => {
      await bot.api.sendMessage(chatId.toString(), text, {
        link_preview_options: { is_disabled: true },
      });
    },
  },
  logger,
});
const readiness = new ReadinessServer(async () => {
  await database.$queryRaw`SELECT 1`;
}, logger);
const oauthServer = calendarOAuth
  ? new OAuthCallbackServer(
      calendarOAuth,
      async (telegramChatId) => {
        await bot.api.sendMessage(
          telegramChatId.toString(),
          '✅ Google Calendar je připojený. Tlačítka u akcí je nyní mohou zapisovat s mangovou barvou.',
        );
      },
      env.NETWORKING_GOOGLE_CALENDAR_REDIRECT_URI!,
      logger,
      'Google Calendar byl připojen. Toto okno můžeš zavřít a vrátit se do Telegramu.',
    )
  : undefined;

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'Shutting down networking bot');
  readiness.markApplicationStopping();
  await scheduler.stop();
  await oauthServer?.stop();
  await bot.stop();
  await readiness.stop();
  await database.$disconnect();
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await readiness.start(env.NETWORKING_HEALTH_PORT);
await oauthServer?.start(
  env.NETWORKING_CALENDAR_OAUTH_LISTEN_PORT,
  env.NETWORKING_CALENDAR_OAUTH_LISTEN_HOST,
);
await bot.api.setMyCommands(networkingBotCommands);
scheduler.start();
await bot.start({
  onStart: () => {
    readiness.markApplicationReady();
    logger.info(
      {
        contactsConfigured: Boolean(contacts),
        businessCardVisionConfigured: Boolean(contacts?.cardParser),
        calendarConfigured,
        timezone: env.NETWORKING_TIMEZONE,
      },
      'Networking bot started',
    );
  },
});
