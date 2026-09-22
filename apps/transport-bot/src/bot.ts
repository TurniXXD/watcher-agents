import type { TransportStore } from '@watcher/database';
import { authorizationMiddleware } from '@watcher/telegram';
import { Bot, InlineKeyboard } from 'grammy';
import { z } from 'zod';
import {
  defaultCostRates,
  defaultPreferences,
  plannedTripSchema,
  vehicleProfileSchema,
} from './config.js';
import type { GeocodingProvider } from './providers.js';
import { mainKeyboard, renderOpportunity } from './render.js';
import type { TransportOpportunityService } from './service.js';
import type { Opportunity, PlannedTrip } from './types.js';

type Conversation =
  | { flow: 'vehicle'; step: 'details' }
  | { flow: 'vehicle'; step: 'base'; draft: Record<string, unknown> }
  | { flow: 'vehicle'; step: 'confirm'; draft: Record<string, unknown> }
  | { flow: 'trip'; step: 'origin' }
  | { flow: 'trip'; step: 'destination'; origin: unknown }
  | { flow: 'trip'; step: 'departure'; origin: unknown; destination: unknown }
  | { flow: 'costs'; step: 'values' }
  | { flow: 'preferences'; step: 'values' };

const conversationSchema = z.custom<Conversation>((value) => Boolean(value));
const numeric = (value: string, label: string): number => {
  const result = Number(value.trim().replace(',', '.'));
  if (!Number.isFinite(result) || result < 0)
    throw new Error(`${label} must be a positive number`);
  return result;
};

const parseVehicle = (text: string): Record<string, unknown> => {
  const parts = text.split(';').map((part) => part.trim());
  if (parts.length < 13)
    throw new Error(
      'Please provide all 13 required values separated by semicolons',
    );
  return {
    manufacturer: parts[0],
    model: parts[1],
    year: numeric(parts[2]!, 'Year'),
    fuelType: parts[3],
    consumptionLitersPer100Km: numeric(parts[4]!, 'Consumption'),
    maximumPermittedWeightKg: numeric(parts[5]!, 'Maximum permitted weight'),
    curbWeightKg: numeric(parts[6]!, 'Curb weight'),
    maximumPayloadKg: numeric(parts[7]!, 'Payload'),
    cargoLengthCm: numeric(parts[8]!, 'Cargo length'),
    cargoWidthCm: numeric(parts[9]!, 'Cargo width'),
    cargoHeightCm: numeric(parts[10]!, 'Cargo height'),
    usableVolumeM3: numeric(parts[11]!, 'Volume'),
    maximumEuroPallets: numeric(parts[12]!, 'Pallet count'),
    restrictions: (parts[13] ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  };
};

const vehiclePrompt = [
  'Send the vehicle details in one message, separated by semicolons:',
  '',
  'manufacturer; model; year; fuel; L/100 km; max permitted kg; curb kg; payload kg; cargo length cm; width cm; height cm; volume m³; EUR pallets; optional restrictions',
  '',
  'Example:',
  'VW; Transporter T5.1 Long; 2013; diesel; 8.5; 3000; 2000; 1000; 290; 170; 140; 6.9; 3; refrigerated',
].join('\n');

const opportunityKeyboard = (
  id: string,
  opportunity: Opportunity,
): InlineKeyboard => {
  const keyboard = new InlineKeyboard();
  const url = opportunity.requests[0]?.sourceUrl;
  if (url) keyboard.url('Open request', url).row();
  return keyboard.text('Ignore', `transport:ignore:${id}`);
};

const replyResults = async (
  ctx: { reply: (text: string, options?: object) => Promise<unknown> },
  result: Awaited<ReturnType<TransportOpportunityService['runForUser']>>,
) => {
  if (result.configurationIssue) {
    await ctx.reply(result.configurationIssue, { reply_markup: mainKeyboard });
    return;
  }
  if (!result.opportunities.length) {
    const sourceNote = result.sourceFailures.length
      ? `\n\nSource failures: ${result.sourceFailures.map(({ source }) => source).join(', ')}`
      : '';
    await ctx.reply(
      `No opportunity met your economic and compatibility thresholds. Checked ${result.requestCount} requests.${sourceNote}`,
      { reply_markup: mainKeyboard },
    );
    return;
  }
  await ctx.reply(
    `Found ${result.opportunities.length} worthwhile ${result.opportunities.length === 1 ? 'opportunity' : 'opportunities'}.`,
  );
  for (const item of result.opportunities.slice(0, 5)) {
    await ctx.reply(renderOpportunity(item.opportunity), {
      reply_markup: opportunityKeyboard(item.id, item.opportunity),
      link_preview_options: { is_disabled: true },
    });
  }
};

export const createTransportBot = (input: {
  token: string;
  allowedUserIds: ReadonlySet<number>;
  store: TransportStore;
  service: TransportOpportunityService;
  geocoding: GeocodingProvider;
  reportError: (error: unknown) => void;
}): Bot => {
  const bot = new Bot(input.token);
  bot.use(authorizationMiddleware(input.allowedUserIds));

  bot.command(['start', 'help'], async (ctx) => {
    const user = await input.service.initializeUser(BigInt(ctx.chat.id));
    await ctx.reply(
      user.onboardingComplete
        ? '🚚 Transport Opportunity Bot\n\nI show only loads that fit your vehicle and pass your economic thresholds.'
        : '🚚 Transport Opportunity Bot\n\nFirst set up your vehicle. I will not assume unknown cargo fits.',
      { reply_markup: mainKeyboard },
    );
    if (!user.onboardingComplete) {
      await input.store.updateUser(BigInt(ctx.chat.id), {
        conversation: { flow: 'vehicle', step: 'details' },
      });
      await ctx.reply(vehiclePrompt);
    }
  });

  bot.hears('🚐 Vehicle', async (ctx) => {
    await input.service.initializeUser(BigInt(ctx.chat.id));
    await input.store.updateUser(BigInt(ctx.chat.id), {
      conversation: { flow: 'vehicle', step: 'details' },
    });
    await ctx.reply(vehiclePrompt);
  });

  bot.hears('📊 Cost settings', async (ctx) => {
    await input.store.ensureUser(BigInt(ctx.chat.id));
    const user = await input.store.getUser(BigInt(ctx.chat.id));
    await input.store.updateUser(BigInt(ctx.chat.id), {
      conversation: { flow: 'costs', step: 'values' },
    });
    await ctx.reply(
      `Current settings: ${JSON.stringify(user?.costSettings ?? defaultCostRates)}\n\nSend: wear/km; maintenance/km; tyres/km; oil/km; insurance/km; driver/hour; diesel price (optional only when a live/cached price exists)\nExample: 2.5; 1.8; 0.6; 0.25; 0.8; 250; 35.90`,
    );
  });

  bot.hears('⚙️ Preferences', async (ctx) => {
    const user = await input.service.initializeUser(BigInt(ctx.chat.id));
    await input.store.updateUser(BigInt(ctx.chat.id), {
      conversation: { flow: 'preferences', step: 'values' },
    });
    await ctx.reply(
      `Current settings: ${JSON.stringify(user.preferences ?? defaultPreferences)}\n\nSend: minimum profit; minimum profit/hour; max empty km; max detour km; max extra minutes; LOW|MEDIUM|HIGH; multiple pickups yes|no\nExample: 1000; 400; 40; 30; 60; MEDIUM; no`,
    );
  });

  bot.hears('🔎 Find jobs', async (ctx) => {
    await ctx.reply('Checking current requests…');
    await replyResults(
      ctx,
      await input.service.runForUser(BigInt(ctx.chat.id)),
    );
  });

  bot.hears("🛣️ I'm planning a trip", async (ctx) => {
    await input.service.initializeUser(BigInt(ctx.chat.id));
    await input.store.updateUser(BigInt(ctx.chat.id), {
      conversation: { flow: 'trip', step: 'origin' },
    });
    await ctx.reply('Where are you leaving from?');
  });

  bot.hears('🔄 Find return load', async (ctx) => {
    const user = await input.store.getUser(BigInt(ctx.chat.id));
    if (!user) return ctx.reply('Use /start first.');
    const latest = await input.store.latestTrip(user.id);
    if (!latest) return ctx.reply('Plan an outbound trip first.');
    const trip = plannedTripSchema.parse(latest.trip);
    const reversed: PlannedTrip = {
      ...trip,
      origin: trip.destination,
      destination: trip.origin,
      departureWindow: {
        from: new Date(Math.max(Date.now(), trip.departureWindow.to.getTime())),
        to: new Date(
          Math.max(Date.now(), trip.departureWindow.to.getTime()) +
            24 * 60 * 60_000,
        ),
      },
    };
    await ctx.reply('Searching geographically useful return loads…');
    await replyResults(
      ctx,
      await input.service.runForUser(
        BigInt(ctx.chat.id),
        reversed,
        'RETURN_LOAD',
      ),
    );
  });

  bot.callbackQuery('vehicle:confirm', async (ctx) => {
    const user = await input.store.getUser(BigInt(ctx.chat!.id));
    const conversation = conversationSchema.parse(user?.conversation);
    if (conversation.flow !== 'vehicle' || conversation.step !== 'confirm')
      return ctx.answerCallbackQuery('Vehicle setup expired');
    const profile = vehicleProfileSchema.parse(conversation.draft);
    await input.store.updateUser(BigInt(ctx.chat!.id), {
      vehicleProfile: profile,
      onboardingComplete: true,
      conversation: null,
    });
    await ctx.answerCallbackQuery('Vehicle saved');
    await ctx.editMessageText(
      '✅ Vehicle profile saved. All values can be changed from 🚐 Vehicle.',
    );
  });

  bot.callbackQuery(/^transport:ignore:/, async (ctx) => {
    const id = ctx.callbackQuery.data.split(':')[2];
    if (!id) return;
    await input.store.ignoreOpportunity(id);
    await ctx.answerCallbackQuery('Ignored');
    await ctx.editMessageReplyMarkup();
  });

  bot.on('message:text', async (ctx) => {
    const user = await input.store.getUser(BigInt(ctx.chat.id));
    if (!user?.conversation) return;
    const conversation = conversationSchema.parse(user.conversation);
    try {
      if (conversation.flow === 'vehicle' && conversation.step === 'details') {
        const draft = parseVehicle(ctx.message.text);
        await input.store.updateUser(BigInt(ctx.chat.id), {
          conversation: { flow: 'vehicle', step: 'base', draft },
        });
        await ctx.reply('What is the vehicle home/base location?');
        return;
      }
      if (conversation.flow === 'vehicle' && conversation.step === 'base') {
        const base = await input.geocoding.geocode(ctx.message.text);
        const profile = vehicleProfileSchema.parse({
          ...conversation.draft,
          base,
        });
        await input.store.updateUser(BigInt(ctx.chat.id), {
          conversation: { flow: 'vehicle', step: 'confirm', draft: profile },
        });
        await ctx.reply(
          `Please confirm:\n${profile.manufacturer} ${profile.model} (${profile.year})\nPayload ${profile.maximumPayloadKg} kg\nCargo ${profile.cargoLengthCm} × ${profile.cargoWidthCm} × ${profile.cargoHeightCm} cm / ${profile.usableVolumeM3} m³\nBase: ${profile.base.address}`,
          {
            reply_markup: new InlineKeyboard().text(
              'Confirm vehicle',
              'vehicle:confirm',
            ),
          },
        );
        return;
      }
      if (conversation.flow === 'costs') {
        const parts = ctx.message.text.split(';');
        if (parts.length < 6)
          throw new Error('Provide at least six semicolon-separated values');
        const current = user.costSettings
          ? z.record(z.string(), z.unknown()).parse(user.costSettings)
          : defaultCostRates;
        const manualFuel = parts[6]?.trim();
        if (!manualFuel && !('fuelPriceCzkPerLiter' in current))
          throw new Error(
            'A manual diesel price is required because no live/cached price is available',
          );
        await input.store.updateUser(BigInt(ctx.chat.id), {
          costSettings: {
            ...current,
            wearCzkPerKm: numeric(parts[0]!, 'Wear'),
            maintenanceCzkPerKm: numeric(parts[1]!, 'Maintenance'),
            tyresCzkPerKm: numeric(parts[2]!, 'Tyres'),
            oilCzkPerKm: numeric(parts[3]!, 'Oil'),
            insuranceCzkPerKm: numeric(parts[4]!, 'Insurance'),
            driverCzkPerHour: numeric(parts[5]!, 'Driver cost'),
            ...(manualFuel
              ? {
                  fuelPriceCzkPerLiter: numeric(manualFuel, 'Fuel price'),
                  fuelPriceSource: 'manual override',
                  fuelPriceUpdatedAt: new Date(),
                  fuelPriceStale: false,
                }
              : {}),
          },
          conversation: null,
        });
        await ctx.reply('✅ Cost settings saved.', {
          reply_markup: mainKeyboard,
        });
        return;
      }
      if (conversation.flow === 'preferences') {
        const parts = ctx.message.text.split(';').map((part) => part.trim());
        if (parts.length < 7)
          throw new Error('Provide all seven preference values');
        await input.store.updateUser(BigInt(ctx.chat.id), {
          preferences: {
            minimumProfitCzk: numeric(parts[0]!, 'Minimum profit'),
            minimumProfitPerHourCzk: numeric(parts[1]!, 'Minimum profit/hour'),
            maximumEmptyKm: numeric(parts[2]!, 'Maximum empty distance'),
            maximumDetourKm: numeric(parts[3]!, 'Maximum detour'),
            maximumAdditionalMinutes: numeric(parts[4]!, 'Maximum extra time'),
            minimumConfidence: z
              .enum(['LOW', 'MEDIUM', 'HIGH'])
              .parse(parts[5]!.toUpperCase()),
            multiplePickups:
              z.enum(['yes', 'no']).parse(parts[6]!.toLowerCase()) === 'yes',
          },
          conversation: null,
        });
        await ctx.reply('✅ Preferences saved.', {
          reply_markup: mainKeyboard,
        });
        return;
      }
      if (conversation.flow === 'trip' && conversation.step === 'origin') {
        const origin = await input.geocoding.geocode(ctx.message.text);
        await input.store.updateUser(BigInt(ctx.chat.id), {
          conversation: { flow: 'trip', step: 'destination', origin },
        });
        await ctx.reply('Where are you going?');
        return;
      }
      if (conversation.flow === 'trip' && conversation.step === 'destination') {
        const destination = await input.geocoding.geocode(ctx.message.text);
        await input.store.updateUser(BigInt(ctx.chat.id), {
          conversation: { ...conversation, step: 'departure', destination },
        });
        await ctx.reply(
          'When are you leaving? Send an ISO date/time, for example 2026-09-23 15:00.',
        );
        return;
      }
      if (conversation.flow === 'trip' && conversation.step === 'departure') {
        const from = new Date(ctx.message.text.replace(' ', 'T'));
        if (Number.isNaN(from.getTime()))
          throw new Error('I could not understand that date/time');
        const preferences = z
          .object({
            maximumDetourKm: z.number(),
            maximumAdditionalMinutes: z.number(),
            multiplePickups: z.boolean(),
          })
          .parse(user.preferences);
        const trip = plannedTripSchema.parse({
          origin: conversation.origin,
          destination: conversation.destination,
          departureWindow: { from, to: new Date(from.getTime() + 60 * 60_000) },
          ...preferences,
        });
        await input.store.updateUser(BigInt(ctx.chat.id), {
          conversation: null,
        });
        await ctx.reply(
          `Baseline: ${trip.origin.address} → ${trip.destination.address}\nSearching incremental economics…`,
        );
        await replyResults(
          ctx,
          await input.service.runForUser(BigInt(ctx.chat.id), trip),
        );
      }
    } catch (error) {
      input.reportError(error);
      await ctx.reply(
        `I could not save that: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  bot.catch(({ error }) => input.reportError(error));
  return bot;
};
