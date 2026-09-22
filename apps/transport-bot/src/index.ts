import { createLogger, ReadinessServer } from '@watcher/core';
import { createDatabaseClient, TransportStore } from '@watcher/database';
import { parseAllowedUserIds } from '@watcher/telegram';
import { createTransportBot } from './bot.js';
import { OpportunityEngine } from './engine.js';
import { env } from './env.js';
import {
  CachedFuelPriceProvider,
  CachedGeocodingProvider,
  CachedRoutingProvider,
  EuCzechDieselPriceProvider,
  JsonFeedTransportRequestProvider,
  OpenMeteoGeocodingProvider,
  OsrmRoutingProvider,
} from './providers.js';
import { renderOpportunity } from './render.js';
import { TransportOpportunityService } from './service.js';
import { locationSchema } from './types.js';
import { z } from 'zod';

const logger = createLogger('transport-bot', env.LOG_LEVEL);
const database = createDatabaseClient(env.DATABASE_URL);
const store = new TransportStore(database);
const fuel = new CachedFuelPriceProvider(
  new EuCzechDieselPriceProvider(
    fetch,
    env.TRANSPORT_FUEL_BULLETIN_URL,
    env.TRANSPORT_CNB_RATE_URL,
  ),
  {
    get: (country, type) => store.getFuelPrice(country, type),
    put: async (country, price) => {
      await store.putFuelPrice(country, price);
    },
  },
);
const routing = new CachedRoutingProvider(
  new OsrmRoutingProvider(env.TRANSPORT_OSRM_URL),
  {
    get: async (key) => {
      const value = await store.getRoute(key);
      if (!value) return undefined;
      const parsed = z
        .object({
          distanceKm: z.number(),
          durationMinutes: z.number(),
          geometry: z.string().optional(),
          tollsCzk: z.number().optional(),
          provider: z.string(),
        })
        .parse(value);
      return {
        distanceKm: parsed.distanceKm,
        durationMinutes: parsed.durationMinutes,
        provider: parsed.provider,
        ...(parsed.geometry ? { geometry: parsed.geometry } : {}),
        ...(parsed.tollsCzk !== undefined ? { tollsCzk: parsed.tollsCzk } : {}),
      };
    },
    put: async (key, route, expiresAt) => {
      await store.putRoute(key, route, expiresAt, route.provider);
    },
  },
);
const service = new TransportOpportunityService(
  store,
  [
    new JsonFeedTransportRequestProvider(
      env.TRANSPORT_REQUEST_FEED_URL,
      env.TRANSPORT_REQUEST_FEED_TOKEN,
    ),
  ],
  fuel,
  new OpportunityEngine(routing),
  logger,
);
const bot = createTransportBot({
  token: env.TRANSPORT_TELEGRAM_TOKEN,
  allowedUserIds: parseAllowedUserIds(env.TELEGRAM_ALLOWED_USER_IDS),
  store,
  service,
  geocoding: new CachedGeocodingProvider(new OpenMeteoGeocodingProvider(), {
    get: async (query) => {
      const value = await store.getGeocoding(query);
      return value ? locationSchema.parse(value) : undefined;
    },
    put: async (query, location, expiresAt) => {
      await store.putGeocoding(query, location, expiresAt, 'Open-Meteo');
    },
  }),
  reportError: (error) =>
    logger.error({ err: error }, 'Telegram update failed'),
});
const readiness = new ReadinessServer(
  async () => database.$queryRaw`SELECT 1`,
  logger,
);

const runDiscovery = () =>
  service.runScheduled(async (chatId, id, opportunity) => {
    await bot.api.sendMessage(
      chatId.toString(),
      renderOpportunity(opportunity),
      {
        reply_markup: {
          inline_keyboard: [
            ...(opportunity.requests[0]?.sourceUrl
              ? [
                  [
                    {
                      text: 'Open request',
                      url: opportunity.requests[0].sourceUrl,
                    },
                  ],
                ]
              : []),
            [{ text: 'Ignore', callback_data: `transport:ignore:${id}` }],
          ],
        },
        link_preview_options: { is_disabled: true },
      },
    );
  });

await readiness.start(env.TRANSPORT_HEALTH_PORT);
const interval = setInterval(
  () => void runDiscovery(),
  env.TRANSPORT_DISCOVERY_INTERVAL_MINUTES * 60_000,
);

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'Shutting down');
  readiness.markApplicationStopping();
  clearInterval(interval);
  await bot.stop();
  await readiness.stop();
  await database.$disconnect();
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

void runDiscovery();
await bot.start({
  onStart: () => {
    readiness.markApplicationReady();
    logger.info({}, 'Transport bot started');
  },
});
