import {
  getWatcherRegistration,
  registeredWatcherBots,
  type WatcherLogger,
} from '@watcher/core';
import type {
  BriefingConfiguration,
  BriefingConfigurationStore,
  BriefingVoiceId,
} from '@watcher/database';
import {
  briefingVoiceIdSchema,
  briefingOnboardingStepSchema,
} from '@watcher/database';
import { authorizationMiddleware, commandArgument } from '@watcher/telegram';
import { Bot, InlineKeyboard, Keyboard, type Context } from 'grammy';
import {
  briefingHelp,
  nextOnboardingStep,
  renderConfiguration,
} from './onboarding.js';
import type { CalendarEvent } from './calendar.js';
import { renderCalendarSummary } from './calendar.js';
import { normalizeHyphenatedBotCommand } from './utils/telegram-command.js';
import type { GeocodingProvider } from './weather.js';

type VoicePreview = (context: Context, voice: BriefingVoiceId) => Promise<void>;
export type BriefingCommandRunner = (
  telegramChatId: bigint,
  type: 'MANUAL' | 'TEST',
  progress: (step: string, percent: number) => Promise<void>,
) => Promise<{ duplicate: boolean; run: { status: string } }>;
export type CalendarCommands = {
  authorizationUrl: (telegramChatId: bigint) => Promise<string>;
  disconnect: (telegramChatId: bigint) => Promise<void>;
  status: (telegramChatId: bigint) => Promise<{ connected: boolean }>;
  eventsToday: (
    telegramChatId: bigint,
    timezone: string,
  ) => Promise<CalendarEvent[]>;
};

const commandName = (text: string | undefined): string =>
  (text ?? '').split(/\s+/, 1)[0]?.replace(/^\//, '').split('@', 1)[0] ?? '';

const subscriptionText = (configuration: BriefingConfiguration): string =>
  [
    'Briefing subscriptions:',
    '',
    ...configuration.subscriptions.map(
      ({ watcherBot, enabled }) =>
        `${enabled ? '✅' : '❌'} ${getWatcherRegistration(watcherBot).displayName}`,
    ),
  ].join('\n');

const onboardingKeyboard = (
  configuration: BriefingConfiguration,
): InlineKeyboard | undefined => {
  const step = briefingOnboardingStepSchema.parse(
    configuration.onboarding.currentStep,
  );
  if (step === 'LOCATION') {
    return new InlineKeyboard()
      .text('📍 Share location', 'onb:location:share')
      .row()
      .text('🏙 Enter city', 'onb:location:city')
      .row()
      .text('Skip for now', 'onb:location:skip');
  }
  if (step === 'VOICE') {
    return new InlineKeyboard()
      .text('▶ Amy', 'onb:voice:amy')
      .row()
      .text('▶ HFC Female', 'onb:voice:hfc_female')
      .row()
      .text('▶ HFC Male', 'onb:voice:hfc_male');
  }
  if (step === 'GOOGLE_CALENDAR') {
    return new InlineKeyboard()
      .text('Connect Calendar', 'onb:calendar:connect')
      .row()
      .text('Skip for now', 'onb:calendar:skip');
  }
  if (step === 'SUBSCRIPTIONS') {
    const keyboard = new InlineKeyboard();
    configuration.subscriptions.forEach(({ watcherBot, enabled }) => {
      keyboard
        .text(
          `${enabled ? '✅' : '❌'} ${watcherBot}`,
          `onb:subscription:${watcherBot}`,
        )
        .row();
    });
    return keyboard.text('Continue', 'onb:subscriptions:continue');
  }
  if (step === 'BRIEFING_TIME') {
    return new InlineKeyboard().text(
      `Use ${configuration.settings.briefingTime}`,
      'onb:time:default',
    );
  }
  if (step === 'COMPLETE') {
    return new InlineKeyboard().text(
      'Generate a test briefing',
      'briefing:test',
    );
  }
  return undefined;
};

const onboardingPrompt = (configuration: BriefingConfiguration): string => {
  const step = configuration.onboarding.currentStep;
  if (step === 'LOCATION') {
    return 'First, choose the location I should use for your morning briefing.';
  }
  if (step === 'VOICE') {
    return 'Choose the voice for your morning briefing.';
  }
  if (step === 'GOOGLE_CALENDAR') {
    return "Google Calendar is optional. Connect it to include today's events, or skip it and continue.";
  }
  if (step === 'SUBSCRIPTIONS') {
    return `${subscriptionText(configuration)}\n\nChoose which watchers to include.`;
  }
  if (step === 'BRIEFING_TIME') {
    return `Choose your local morning briefing time. Use /briefing_time HH:mm, or keep ${configuration.settings.briefingTime}.`;
  }
  return `Setup complete.\n\n${renderConfiguration(configuration)}`;
};

export const createBriefingBot = (
  token: string,
  allowedIds: ReadonlySet<number>,
  store: BriefingConfigurationStore,
  reportError: (error: unknown) => void,
  previewVoice?: VoicePreview,
  geocoding?: GeocodingProvider,
  calendar?: CalendarCommands,
  runBriefing?: BriefingCommandRunner,
  logger?: WatcherLogger,
): Bot => {
  const bot = new Bot(token);
  bot.use(authorizationMiddleware(allowedIds));
  bot.use(async (context, next) => {
    normalizeHyphenatedBotCommand(context.message);
    await next();
  });
  bot.use(async (context, next) => {
    const startedAt = Date.now();
    const command = commandName(context.message?.text);
    const callback = context.callbackQuery?.data;
    const fields = {
      updateId: context.update.update_id,
      telegramChatId: context.chat?.id.toString(),
      telegramUserId: context.from?.id.toString(),
      ...(command ? { command } : {}),
      ...(callback ? { callback } : {}),
    };
    const message = command
      ? 'Briefing bot command received'
      : callback
        ? 'Briefing bot callback received'
        : 'Briefing bot update received';
    if (command || callback) logger?.info(fields, message);
    else logger?.debug(fields, message);
    try {
      await next();
      const completedFields = {
        ...fields,
        durationMs: Date.now() - startedAt,
      };
      const completedMessage = command
        ? 'Briefing bot command completed'
        : callback
          ? 'Briefing bot callback completed'
          : 'Briefing bot update completed';
      if (command || callback) logger?.info(completedFields, completedMessage);
      else logger?.debug(completedFields, completedMessage);
    } catch (error) {
      logger?.error(
        { ...fields, err: error, durationMs: Date.now() - startedAt },
        'Briefing bot update failed',
      );
      throw error;
    }
  });

  const prompt = async (
    context: Context,
    configuration: BriefingConfiguration,
  ): Promise<void> => {
    const keyboard = onboardingKeyboard(configuration);
    await context.reply(onboardingPrompt(configuration), {
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
  };

  const advance = async (
    context: Context,
    configuration: BriefingConfiguration,
  ): Promise<void> => {
    const updated = await store.setOnboardingStep(
      BigInt(context.chat!.id),
      nextOnboardingStep(configuration.onboarding.currentStep),
    );
    await prompt(context, updated);
  };

  bot.command('start', async (context) => {
    let configuration = await store.ensure(BigInt(context.chat.id));
    if (configuration.onboarding.currentStep === 'GOOGLE_CALENDAR') {
      configuration = await store.setOnboardingStep(
        BigInt(context.chat.id),
        'SUBSCRIPTIONS',
      );
    }
    if (configuration.onboarding.completed) {
      await context.reply(
        `☀️ Personal Morning Briefing\n\n${renderConfiguration(configuration)}\n\n${briefingHelp}`,
      );
      return;
    }
    await prompt(context, configuration);
  });
  bot.command('help', async (context) => context.reply(briefingHelp));
  bot.command(['settings', 'briefing_settings'], async (context) => {
    await context.reply(
      renderConfiguration(await store.ensure(BigInt(context.chat.id))),
    );
  });
  bot.command('subscriptions', async (context) => {
    await context.reply(
      subscriptionText(await store.ensure(BigInt(context.chat.id))),
    );
  });
  bot.command(['subscribe', 'unsubscribe'], async (context) => {
    const watcher = commandArgument(context.message?.text);
    if (!watcher) {
      await context.reply(
        `Available watchers: ${registeredWatcherBots.join(', ')}\nUsage: /subscribe mu-clubs`,
      );
      return;
    }
    const configuration = await store.setSubscription(
      BigInt(context.chat.id),
      watcher,
      commandName(context.message?.text) === 'subscribe',
    );
    await context.reply(subscriptionText(configuration));
  });
  bot.command(['subscribe_all', 'unsubscribe_all'], async (context) => {
    const configuration = await store.setAllSubscriptions(
      BigInt(context.chat.id),
      commandName(context.message?.text) === 'subscribe_all',
    );
    await context.reply(subscriptionText(configuration));
  });
  bot.command(['location', 'location_status'], async (context) => {
    const configuration = await store.ensure(BigInt(context.chat.id));
    await context.reply(renderConfiguration(configuration));
  });
  bot.command('location_set', async (context) => {
    const query = commandArgument(context.message?.text);
    if (query && geocoding) {
      const [location] = await geocoding.search(
        query,
        AbortSignal.timeout(10_000),
      );
      if (!location) {
        await context.reply('No matching city was found.');
        return;
      }
      await store.setLocation(BigInt(context.chat.id), {
        mode: 'STATIC',
        city: location.city,
        ...(location.country ? { country: location.country } : {}),
        latitude: location.latitude,
        longitude: location.longitude,
      });
      const configuration = await store.updateSettings(
        BigInt(context.chat.id),
        {
          timezone: location.timezone,
        },
      );
      await context.reply(
        `Location set to ${location.city}${location.country ? `, ${location.country}` : ''}.`,
      );
      if (configuration.onboarding.currentStep === 'LOCATION') {
        await advance(context, configuration);
      }
      return;
    }
    await context.reply('Share a Telegram location using the button below.', {
      reply_markup: new Keyboard()
        .requestLocation('Share current location')
        .resized()
        .oneTime(),
    });
  });
  bot.command('location_clear', async (context) => {
    await store.clearLocation(BigInt(context.chat.id));
    await context.reply('Location disabled.');
  });
  bot.on('message:location', async (context) => {
    const configuration = await store.setLocation(BigInt(context.chat.id), {
      mode: 'LAST_SHARED',
      latitude: context.message.location.latitude,
      longitude: context.message.location.longitude,
    });
    await context.reply('Location saved.', {
      reply_markup: { remove_keyboard: true },
    });
    if (configuration.onboarding.currentStep === 'LOCATION') {
      await advance(context, configuration);
    }
  });
  bot.command(['voice', 'voice_list'], async (context) => {
    const configuration = await store.ensure(BigInt(context.chat.id));
    await context.reply(
      commandName(context.message?.text) === 'voice'
        ? `Current voice: ${configuration.settings.voice}`
        : 'Available voices:\namy\nhfc_female\nhfc_male',
    );
  });
  bot.command('voice_set', async (context) => {
    const voice = briefingVoiceIdSchema.parse(
      commandArgument(context.message?.text),
    );
    let configuration = await store.updateSettings(BigInt(context.chat.id), {
      voice,
    });
    await context.reply(`Voice set to ${voice}.`);
    if (configuration.onboarding.currentStep === 'VOICE') {
      configuration = await store.setOnboardingStep(
        BigInt(context.chat.id),
        'SUBSCRIPTIONS',
      );
      await prompt(context, configuration);
    }
  });
  bot.command('voice_preview', async (context) => {
    const voice = briefingVoiceIdSchema.parse(
      commandArgument(context.message?.text),
    );
    if (previewVoice) await previewVoice(context, voice);
    else await context.reply('Voice previews are not installed yet.');
  });
  bot.command('briefing_time', async (context) => {
    const briefingTime = commandArgument(context.message?.text);
    let configuration = await store.updateSettings(BigInt(context.chat.id), {
      briefingTime,
    });
    if (configuration.onboarding.currentStep === 'BRIEFING_TIME') {
      configuration = await store.setOnboardingStep(
        BigInt(context.chat.id),
        'COMPLETE',
      );
    }
    await context.reply(renderConfiguration(configuration));
  });
  bot.command('briefing_duration', async (context) => {
    const minutes = Number(commandArgument(context.message?.text));
    if (!Number.isInteger(minutes)) {
      await context.reply('Usage: /briefing_duration MINUTES');
      return;
    }
    const configuration = await store.updateSettings(BigInt(context.chat.id), {
      targetDurationMinutes: minutes,
    });
    await context.reply(renderConfiguration(configuration));
  });
  bot.command('briefing_max_duration', async (context) => {
    const minutes = Number(commandArgument(context.message?.text));
    if (!Number.isInteger(minutes)) {
      await context.reply('Usage: /briefing_max_duration MINUTES');
      return;
    }
    const configuration = await store.updateSettings(BigInt(context.chat.id), {
      maximumDurationMinutes: minutes,
    });
    await context.reply(renderConfiguration(configuration));
  });
  bot.command('briefing_transcript', async (context) => {
    const mode = commandArgument(context.message?.text)?.toLowerCase();
    if (mode !== 'on' && mode !== 'off') {
      await context.reply('Usage: /briefing_transcript on|off');
      return;
    }
    const configuration = await store.updateSettings(BigInt(context.chat.id), {
      sendTranscript: mode === 'on',
    });
    await context.reply(renderConfiguration(configuration));
  });

  const executeBriefing = async (
    context: Context,
    type: 'MANUAL' | 'TEST',
  ): Promise<void> => {
    if (!runBriefing) {
      await context.reply('Briefing generation is not configured.');
      return;
    }
    const status = await context.reply('⏳ Preparing briefing…');
    const result = await runBriefing(
      BigInt(context.chat!.id),
      type,
      async (step, percent) => {
        await context.api.editMessageText(
          context.chat!.id,
          status.message_id,
          `⏳ Preparing briefing… ${percent}%\n${step}`,
        );
      },
    );
    await context.api.editMessageText(
      context.chat!.id,
      status.message_id,
      result.duplicate
        ? 'This scheduled briefing was already delivered.'
        : `✅ Briefing finished with status ${result.run.status}.`,
    );
  };

  bot.command('briefing', (context) => executeBriefing(context, 'MANUAL'));
  bot.command('briefing_test', (context) => executeBriefing(context, 'TEST'));
  bot.command('calendar_status', async (context) => {
    const connected = calendar
      ? (await calendar.status(BigInt(context.chat.id))).connected
      : false;
    await context.reply(
      connected
        ? 'Google Calendar is enabled.'
        : 'Google Calendar is not connected.',
    );
  });
  bot.command('calendar_connect', async (context) => {
    if (!calendar) {
      await context.reply(
        'Google Calendar OAuth is not configured on this server yet.',
      );
      return;
    }
    const url = await calendar.authorizationUrl(BigInt(context.chat.id));
    await context.reply('Open this private link to connect Google Calendar:', {
      reply_markup: new InlineKeyboard().url('Connect Google Calendar', url),
    });
  });
  bot.command('calendar_refresh', async (context) => {
    if (!calendar) {
      await context.reply(
        'Google Calendar OAuth is not configured on this server yet.',
      );
      return;
    }
    const configuration = await store.ensure(BigInt(context.chat.id));
    const events = await calendar.eventsToday(
      BigInt(context.chat.id),
      configuration.settings.timezone,
    );
    await context.reply(renderCalendarSummary(events));
  });
  bot.command('calendar_disconnect', async (context) => {
    if (calendar) await calendar.disconnect(BigInt(context.chat.id));
    else {
      await store.updateSettings(BigInt(context.chat.id), {
        calendarEnabled: false,
      });
    }
    await context.reply('Google Calendar disconnected.');
  });

  bot.callbackQuery('onb:location:share', async (context) => {
    await context.answerCallbackQuery();
    await context.reply('Share your location using the button below.', {
      reply_markup: new Keyboard()
        .requestLocation('Share current location')
        .resized()
        .oneTime(),
    });
  });
  bot.callbackQuery('onb:location:city', async (context) => {
    await context.answerCallbackQuery();
    await context.reply('Enter a city with /location_set CITY, COUNTRY.');
  });
  bot.callbackQuery('onb:location:skip', async (context) => {
    const configuration = await store.clearLocation(BigInt(context.chat!.id));
    await context.answerCallbackQuery();
    await advance(context, configuration);
  });
  bot.callbackQuery(
    /^onb:voice:(amy|hfc_female|hfc_male)$/,
    async (context) => {
      const voice = briefingVoiceIdSchema.parse(context.match[1]);
      await context.answerCallbackQuery('Generating preview');
      if (previewVoice) await previewVoice(context, voice);
      else await context.reply('Voice previews are not installed yet.');
      await context.reply(`Use ${voice} for your morning briefing?`, {
        reply_markup: new InlineKeyboard().text(
          'Use this voice',
          `onb:voice:use:${voice}`,
        ),
      });
    },
  );
  bot.callbackQuery(/^onb:voice:use:(.+)$/, async (context) => {
    const voice = briefingVoiceIdSchema.parse(context.match[1]);
    await store.updateSettings(BigInt(context.chat!.id), { voice });
    const configuration = await store.setOnboardingStep(
      BigInt(context.chat!.id),
      'SUBSCRIPTIONS',
    );
    await context.answerCallbackQuery();
    await prompt(context, configuration);
  });
  bot.callbackQuery('onb:calendar:connect', async (context) => {
    await context.answerCallbackQuery();
    if (!calendar) {
      await context.reply(
        'Google Calendar OAuth is not configured on this server yet. You can skip for now.',
      );
      return;
    }
    const url = await calendar.authorizationUrl(BigInt(context.chat!.id));
    await context.reply('Open this private link to connect Google Calendar:', {
      reply_markup: new InlineKeyboard().url('Connect Google Calendar', url),
    });
  });
  bot.callbackQuery('onb:calendar:skip', async (context) => {
    await store.updateSettings(BigInt(context.chat!.id), {
      calendarEnabled: false,
    });
    const configuration = await store.setOnboardingStep(
      BigInt(context.chat!.id),
      'SUBSCRIPTIONS',
    );
    await context.answerCallbackQuery();
    await prompt(context, configuration);
  });
  bot.callbackQuery(
    /^onb:subscription:(stocks|medical|news|mu-clubs)$/,
    async (context) => {
      const current = await store.ensure(BigInt(context.chat!.id));
      const watcher = context.match[1];
      const subscription = current.subscriptions.find(
        ({ watcherBot }) => watcherBot === watcher,
      );
      const configuration = await store.setSubscription(
        BigInt(context.chat!.id),
        watcher,
        !(subscription?.enabled ?? false),
      );
      await context.answerCallbackQuery('Updated');
      const keyboard = onboardingKeyboard(configuration);
      await context.editMessageText(onboardingPrompt(configuration), {
        ...(keyboard ? { reply_markup: keyboard } : {}),
      });
    },
  );
  bot.callbackQuery('onb:subscriptions:continue', async (context) => {
    const configuration = await store.setOnboardingStep(
      BigInt(context.chat!.id),
      'BRIEFING_TIME',
    );
    await context.answerCallbackQuery();
    await prompt(context, configuration);
  });
  bot.callbackQuery('onb:time:default', async (context) => {
    const configuration = await store.setOnboardingStep(
      BigInt(context.chat!.id),
      'COMPLETE',
    );
    await context.answerCallbackQuery();
    await prompt(context, configuration);
  });
  bot.callbackQuery('briefing:test', async (context) => {
    await context.answerCallbackQuery('Generating test briefing');
    await executeBriefing(context, 'TEST');
  });

  bot.catch(async (error) => {
    reportError(error.error);
    try {
      await error.ctx.reply('Request failed. Check the bot logs for details.');
    } catch {
      // Reporting must not create another unhandled Telegram error.
    }
  });
  return bot;
};
