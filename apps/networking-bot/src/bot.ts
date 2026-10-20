import { Bot, InlineKeyboard, type Context } from 'grammy';
import type { SocialsStore } from '@watcher/database';
import {
  authorizationMiddleware,
  splitTelegramMessage,
} from '@watcher/telegram';
import {
  networkBotCommands,
  registerNetworkHandlers,
  type NetworkBotDependencies,
} from '@watcher/contact-network';
import { networkingEventSources } from './source-registry.js';
import type { NetworkingService } from './service.js';
import { dateInTimezone, formatLocalDateTime } from './time.js';

const debriefQuestions = [
  ['highlights', 'Co bylo na akci nejzajímavější?'],
  ['lessons', 'Co konkrétního sis odnesl nebo naučil?'],
  ['notes', 'S kým nebo o čem jsi mluvil? Neuváděj zbytečně citlivé údaje.'],
] as const;

export const networkingHelp = `🤝 Networking Bot

Samostatně spravuje osobní kontakty, čtení vizitek, doporučení akcí, účast a follow-upy. Socials tyto příkazy neobsluhuje; Sales zachovává jen kompatibilní kontaktní příkazy.

/networking — doporučené akce a aktuální účasti
/network_events — akce na následujících osm dní
/network_events_free — pouze ověřeně bezplatné akce
/networking_today — dnešní prezenční akce
/networking_free_food — akce tento týden s doloženým jídlem nebo občerstvením zdarma
/networking_calendar_connect — bezpečně připojit Google Calendar pro zápis akcí
/networking_calendar_status — stav propojení s Google Calendarem
/network_event_add Název | 2026-10-20 18:00 | Brno | https://... | free
/network_sources — skutečně napojené zdroje včetně Objev Brno, Impact Hubu, Velvet Innovation, Base48 a ČSOB Validation Campů
/network_event_contacts — kontakty poznamenané u akcí a jejich follow-upy

/network_add <popis> — připravit kontakt do Google Sheet
/network_search <dotaz> — hledat v osobním networku
/network_contact <jméno nebo ID> — detail kontaktu
/network_update <jméno nebo ID> | <změna> — změnit jedno pole
/network_intro <jméno nebo ID> — doporučit propojení
/network_followups — vypsat další domluvené kroky
/about — účel, datové toky, soukromí a omezení bota

Fotografii vizitky bot přečte pomocí nakonfigurovaného Ollama vision modelu. Před uložením vždy zobrazí návrh, zkontroluje duplicity a vyžádá potvrzení.`;

export const networkingAbout = `🤝 O Networking Botu

Networking Bot je soukromý pracovní prostor pro profesní kontakty a osobní účast na akcích. Doporučuje prezenční události z normalizovaného katalogu Brno Events, eviduje výslovně zvolenou účast a připomíná schválené follow-upy. Čistě online akce do výpisů nezařazuje.

Po výslovném propojení může vybranou akci zapsat do primárního Google Calendaru s mangovou barvou. Opakované stisknutí nevytváří duplicitu. Registraci za operátora nikdy neodesílá; u akcí s doloženou povinnou registrací pouze ukazuje registrační odkaz.

Kontakty ukládá do nakonfigurovaného Google Sheetu. Fotografii vizitky může přečíst lokálním Ollama vision modelem, ale před zápisem vždy zobrazí návrh, zkontroluje možné duplicity a čeká na potvrzení operátora.

Bot automaticky nekontaktuje jiné lidi, nepotvrzuje registraci ani účast, nevymýšlí chybějící údaje a nepovažuje neznámou cenu za vstup zdarma. Telegram je soukromé ovládání chráněné allowlistem.

Začni přes /networking. Kompletní příkazy zobrazí /help.`;

export const networkingBotCommands = [
  { command: 'help', description: 'Návod k Networking botu' },
  { command: 'about', description: 'Účel, data, soukromí a omezení' },
  { command: 'networking', description: 'Doporučené akce a účast' },
  { command: 'network_events', description: 'Nadcházející networkingové akce' },
  { command: 'network_events_free', description: 'Ověřeně bezplatné akce' },
  { command: 'networking_today', description: 'Dnešní prezenční akce' },
  {
    command: 'networking_free_food',
    description: 'Tento týden s občerstvením zdarma',
  },
  {
    command: 'networking_calendar_connect',
    description: 'Připojit Google Calendar',
  },
  {
    command: 'networking_calendar_status',
    description: 'Stav Google Calendaru',
  },
  { command: 'network_event_add', description: 'Přidat ověřitelnou akci' },
  { command: 'network_sources', description: 'Zdroje eventů a jejich stav' },
  {
    command: 'network_event_contacts',
    description: 'Kontakty a follow-upy z akcí',
  },
  ...networkBotCommands,
] as const;

type Dependencies = {
  token: string;
  allowedIds: ReadonlySet<number>;
  store: SocialsStore;
  service: NetworkingService;
  timezone: string;
  contacts?: NetworkBotDependencies;
  calendar?: {
    authorizationUrl(telegramChatId: bigint): Promise<string>;
    status(telegramChatId: bigint): Promise<{ connected: boolean }>;
  };
  reportError(error: unknown): void;
};

const argument = (ctx: Context): string =>
  typeof ctx.match === 'string' ? ctx.match.trim() : '';

const replyLong = async (ctx: Context, message: string): Promise<void> => {
  for (const part of splitTelegramMessage(message, 3900)) {
    await ctx.reply(part, { link_preview_options: { is_disabled: true } });
  }
};

const eventPrice = (status: string): string =>
  status === 'FREE'
    ? 'zdarma'
    : status === 'PAID'
      ? 'placené'
      : 'cena neověřena';

const renderEvents = async (
  ctx: Context,
  dependencies: Dependencies,
  options: {
    freeOnly?: boolean;
    freeFoodOnly?: boolean;
    range?: 'NEXT_EIGHT_DAYS' | 'TODAY' | 'THIS_WEEK';
    emptyMessage?: string;
  } = {},
): Promise<void> => {
  if (!ctx.from || !ctx.chat) return;
  const { emptyMessage, ...discoveryOptions } = options;
  const events = await dependencies.service.discoverEvents(
    BigInt(ctx.from.id),
    BigInt(ctx.chat.id),
    discoveryOptions,
  );
  if (!events.length) {
    await ctx.reply(
      emptyMessage ??
        (options.freeOnly
          ? 'Na příštích osm dní nejsou žádné ověřeně bezplatné akce.'
          : 'Na příštích osm dní nejsou žádné odpovídající akce.'),
    );
    return;
  }
  for (const event of events) {
    const sourceNames = event.sourceReferences
      .map((source) => source.provider)
      .filter(Boolean)
      .join(', ');
    const registrationRequired = event.accessType === 'REGISTRATION_REQUIRED';
    const keyboard = new InlineKeyboard()
      .text('🥭 Přidat do kalendáře', `networking:calendar:${event.id}`)
      .row();
    if (registrationRequired && event.registrationUrl) {
      keyboard.url('📝 Registrovat se', event.registrationUrl).row();
    }
    keyboard
      .text('⭐ Mám zájem', `networking:att:INTERESTED:${event.id}`)
      .text('✅ Registrován', `networking:att:REGISTERED:${event.id}`)
      .row()
      .text('🚫 Neúčastním se', `networking:att:CANCELLED:${event.id}`);
    const registration = registrationRequired
      ? event.registrationUrl
        ? `\nRegistrace je nutná: ${event.registrationUrl}`
        : '\nRegistrace je nutná; zdroj neposkytl samostatný registrační odkaz.'
      : '';
    await ctx.reply(
      `🤝 ${event.title}\n${formatLocalDateTime(event.startAt, event.timezone)} · ${event.venue ?? event.city ?? 'místo neověřeno'} · ${eventPrice(event.priceStatus)}\nZdroj: ${sourceNames || event.sourceProvider}\n${event.canonicalUrl ?? ''}${registration}`,
      {
        link_preview_options: { is_disabled: true },
        reply_markup: keyboard,
      },
    );
  }
};

export const createNetworkingBot = (dependencies: Dependencies): Bot => {
  const bot = new Bot(dependencies.token);
  const debriefs = new Map<
    number,
    { attendanceId: string; index: number; answers: Record<string, string> }
  >();
  bot.use(authorizationMiddleware(dependencies.allowedIds));
  bot.command(['start', 'help', 'networking_help'], (ctx) =>
    replyLong(ctx, networkingHelp),
  );
  bot.command('about', (ctx) => replyLong(ctx, networkingAbout));
  bot.command('networking', async (ctx) => {
    if (!ctx.from || !ctx.chat) return;
    const value = argument(ctx);
    if (value.toLowerCase().startsWith('prefs ')) {
      const values: Record<string, string> = {};
      for (const part of value.slice(6).split(';')) {
        const separator = part.indexOf('=');
        if (separator > 0) {
          values[part.slice(0, separator).trim()] = part
            .slice(separator + 1)
            .trim();
        }
      }
      const current = await dependencies.store.ensureSettings(
        BigInt(ctx.from.id),
        BigInt(ctx.chat.id),
      );
      const integer = (candidate: string | undefined, fallback: number) => {
        const parsed = Number(candidate);
        return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
      };
      const updated = await dependencies.store.updateSettings(
        BigInt(ctx.from.id),
        {
          ...(values.cities
            ? {
                preferredCities: values.cities
                  .split(',')
                  .map((city) => city.trim())
                  .filter(Boolean),
              }
            : {}),
          travelRadiusKm: integer(values.radius, current.travelRadiusKm),
          maximumEventPriceCzk: integer(
            values.max,
            current.maximumEventPriceCzk,
          ),
          weeklyRecommendationCount: Math.min(
            20,
            Math.max(
              1,
              integer(values.count, current.weeklyRecommendationCount),
            ),
          ),
          mondayNetworkingReminder:
            values.monday === undefined
              ? current.mondayNetworkingReminder
              : values.monday.toLowerCase() !== 'off',
        },
      );
      await ctx.reply(
        `✅ Preference: ${updated.preferredCities.join(', ')}, rádius ${updated.travelRadiusKm} km, max ${updated.maximumEventPriceCzk} Kč, ${updated.weeklyRecommendationCount} doporučení, pondělní připomínka ${updated.mondayNetworkingReminder ? 'zapnuta' : 'vypnuta'}.`,
      );
      return;
    }
    for (const attendance of (
      await dependencies.store.listAttendances(BigInt(ctx.from.id))
    ).slice(0, 10)) {
      const keyboard = new InlineKeyboard();
      if (
        ['INTERESTED', 'REGISTERED'].includes(attendance.status) &&
        attendance.event.startAt <= new Date()
      ) {
        keyboard.text(
          '✅ Opravdu jsem se zúčastnil',
          `networking:attended:${attendance.id}`,
        );
      }
      await ctx.reply(
        `${attendance.event.title}\n${formatLocalDateTime(attendance.event.startAt, attendance.event.timezone)} · ${attendance.status}\nAttendance ID: ${attendance.id}`,
        keyboard.inline_keyboard.length ? { reply_markup: keyboard } : {},
      );
    }
    await renderEvents(ctx, dependencies);
  });
  bot.command('network_events', (ctx) => renderEvents(ctx, dependencies));
  bot.command('network_events_free', (ctx) =>
    renderEvents(ctx, dependencies, { freeOnly: true }),
  );
  bot.command('networking_today', (ctx) =>
    renderEvents(ctx, dependencies, {
      range: 'TODAY',
      emptyMessage: 'Dnes už nejsou žádné odpovídající prezenční akce.',
    }),
  );
  bot.command('networking_free_food', (ctx) =>
    renderEvents(ctx, dependencies, {
      range: 'THIS_WEEK',
      freeFoodOnly: true,
      emptyMessage:
        'Do konce tohoto týdne nejsou žádné akce s doloženým jídlem nebo občerstvením zdarma.',
    }),
  );
  bot.command('networking_calendar_connect', async (ctx) => {
    if (!dependencies.calendar) {
      await ctx.reply(
        'Google Calendar zatím není na serveru pro Networking bot nakonfigurován.',
      );
      return;
    }
    const url = await dependencies.calendar.authorizationUrl(
      BigInt(ctx.chat.id),
    );
    await ctx.reply(
      'Otevři soukromý odkaz a povol zápis akcí do Google Calendaru:',
      {
        reply_markup: new InlineKeyboard().url('Připojit Google Calendar', url),
      },
    );
  });
  bot.command('networking_calendar_status', async (ctx) => {
    const connected = dependencies.calendar
      ? (await dependencies.calendar.status(BigInt(ctx.chat.id))).connected
      : false;
    await ctx.reply(
      connected
        ? '✅ Google Calendar je připojený pro zápis networkingových akcí.'
        : 'Google Calendar není připojený. Použij /networking_calendar_connect.',
    );
  });
  bot.command('network_sources', (ctx) =>
    replyLong(
      ctx,
      `🔎 Zdroje akcí\n\n${networkingEventSources
        .map(
          (source) =>
            `• ${source.name} — ${source.mode}\n  ${source.notes}\n  ${source.url}`,
        )
        .join('\n\n')}`,
    ),
  );
  bot.command('network_event_add', async (ctx) => {
    if (!ctx.from) return;
    const [title, dateTime, city, sourceUrl, price] = argument(ctx)
      .split('|')
      .map((part) => part.trim());
    const match = dateTime?.match(
      /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/u,
    );
    if (!title || !match || !sourceUrl) {
      await ctx.reply(
        'Použití: /network_event_add Název | 2026-10-20 18:00 | Brno | https://oficialni-url | free/paid/unknown',
      );
      return;
    }
    const event = await dependencies.service.addManualEvent({
      ownerUserId: BigInt(ctx.from.id),
      title,
      startAt: dateInTimezone(
        {
          year: Number(match[1]),
          month: Number(match[2]),
          day: Number(match[3]),
          hour: Number(match[4]),
          minute: Number(match[5]),
        },
        dependencies.timezone,
      ),
      ...(city ? { city } : {}),
      sourceUrl,
      priceStatus:
        price?.toLowerCase() === 'free'
          ? 'FREE'
          : price?.toLowerCase() === 'paid'
            ? 'PAID'
            : 'UNKNOWN',
    });
    await ctx.reply(
      `✅ Akce uložena jako ${event.verificationStatus}; cenu bot bez důkazu nepovažuje za bezplatnou.`,
    );
  });
  bot.command('network_event_contacts', async (ctx) => {
    if (!ctx.from) return;
    const value = argument(ctx);
    if (value.toLowerCase().startsWith('add ')) {
      const [attendanceId, displayName, organization, notes] = value
        .slice(4)
        .split('|')
        .map((part) => part.trim());
      if (!attendanceId || !displayName) {
        await ctx.reply(
          'Použití: /network_event_contacts add ATTENDANCE_ID | Jméno | organizace | poznámka',
        );
        return;
      }
      await dependencies.store.addContact({
        ownerUserId: BigInt(ctx.from.id),
        attendanceId,
        displayName,
        ...(organization ? { organization } : {}),
        ...(notes ? { conversationNotes: notes } : {}),
      });
      await ctx.reply('✅ Kontakt uložen soukromě k dané účasti.');
      return;
    }
    if (value.toLowerCase().startsWith('done ')) {
      await dependencies.store.completeFollowUp(
        BigInt(ctx.from.id),
        value.slice(5).trim(),
      );
      await ctx.reply('✅ Follow-up označen jako dokončený.');
      return;
    }
    if (value.toLowerCase().startsWith('delete ')) {
      await dependencies.store.deleteContact(
        BigInt(ctx.from.id),
        value.slice(7).trim(),
      );
      await ctx.reply('🗑️ Kontakt a jeho follow-upy byly odstraněny.');
      return;
    }
    if (value.toLowerCase().startsWith('followup ')) {
      const [contactId, title, dueDate] = value
        .slice(9)
        .split('|')
        .map((part) => part.trim());
      const match = dueDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
      if (!contactId || !title || !match) {
        await ctx.reply(
          'Použití: /network_event_contacts followup CONTACT_ID | Co udělat | 2026-10-20',
        );
        return;
      }
      const followUp = await dependencies.store.createFollowUp({
        ownerUserId: BigInt(ctx.from.id),
        contactId,
        title,
        dueAt: dateInTimezone(
          {
            year: Number(match[1]),
            month: Number(match[2]),
            day: Number(match[3]),
            hour: 9,
            minute: 0,
          },
          dependencies.timezone,
        ),
      });
      await ctx.reply(`✅ Follow-up uložen. ID: ${followUp.id}.`);
      return;
    }
    const contacts = await dependencies.store.listContacts(BigInt(ctx.from.id));
    await replyLong(
      ctx,
      `👥 Kontakty z akcí\n${
        contacts
          .map(
            (contact) =>
              `• ${contact.displayName}${contact.organization ? ` · ${contact.organization}` : ''}\n  ID: ${contact.id}\n${contact.followUps.map((followUp) => `  ⏰ ${formatLocalDateTime(followUp.dueAt, dependencies.timezone)} — ${followUp.title} (${followUp.id})`).join('\n') || '  bez otevřeného follow-upu'}`,
          )
          .join('\n') || 'Žádné kontakty z akcí.'
      }\n\nPříkazy: add · followup · done · delete. Bot kontaktům nic neposílá automaticky.`,
    );
  });
  bot.callbackQuery(/^networking:calendar:([0-9a-f-]{36})$/u, async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Přidávám do kalendáře…' });
    if (!ctx.chat || !dependencies.calendar) {
      await ctx.reply(
        'Google Calendar zatím není nakonfigurován. Správce musí doplnit OAuth nastavení.',
      );
      return;
    }
    const chatId = BigInt(ctx.chat.id);
    if (!(await dependencies.calendar.status(chatId)).connected) {
      const url = await dependencies.calendar.authorizationUrl(chatId);
      await ctx.reply('Nejdřív připoj Google Calendar:', {
        reply_markup: new InlineKeyboard().url('Připojit Google Calendar', url),
      });
      return;
    }
    try {
      const { event, calendarEvent } =
        await dependencies.service.addEventToCalendar(
          BigInt(ctx.from.id),
          chatId,
          ctx.match[1]!,
        );
      const keyboard = new InlineKeyboard();
      if (calendarEvent.htmlLink) {
        keyboard.url('Otevřít v Google Calendaru', calendarEvent.htmlLink);
      }
      if (
        event.accessType === 'REGISTRATION_REQUIRED' &&
        event.registrationUrl
      ) {
        if (calendarEvent.htmlLink) keyboard.row();
        keyboard.url('📝 Registrovat se', event.registrationUrl);
      }
      await ctx.reply(
        calendarEvent.duplicate
          ? `ℹ️ ${event.title} už v Google Calendaru je.`
          : `✅ ${event.title} byl přidán do Google Calendaru s mangovou barvou.`,
        keyboard.inline_keyboard.length ? { reply_markup: keyboard } : {},
      );
    } catch (error) {
      dependencies.reportError(error);
      const message = error instanceof Error ? error.message : '';
      if (/write access is missing/iu.test(message)) {
        const url = await dependencies.calendar.authorizationUrl(chatId);
        await ctx.reply(
          'Připojení nemá oprávnění zapisovat. Obnov ho tímto odkazem:',
          {
            reply_markup: new InlineKeyboard().url(
              'Obnovit oprávnění Calendaru',
              url,
            ),
          },
        );
        return;
      }
      await ctx.reply(
        'Akci se nepodařilo přidat do Google Calendaru. Zkus to prosím znovu.',
      );
    }
  });
  bot.callbackQuery(
    /^networking:att:(INTERESTED|REGISTERED|CANCELLED):([\w-]+)$/u,
    async (ctx) => {
      await ctx.answerCallbackQuery();
      const attendance = await dependencies.store.setAttendance({
        ownerUserId: BigInt(ctx.from.id),
        eventId: ctx.match[2]!,
        status: ctx.match[1] as 'INTERESTED' | 'REGISTERED' | 'CANCELLED',
      });
      await ctx.reply(`✅ Stav účasti: ${attendance.status}.`);
    },
  );
  bot.callbackQuery(/^networking:attended:([\w-]+)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    debriefs.set(ctx.from.id, {
      attendanceId: ctx.match[1]!,
      index: 0,
      answers: {},
    });
    await ctx.reply(debriefQuestions[0][1]);
  });
  bot.on('message:text', async (ctx, next) => {
    const current = debriefs.get(ctx.from.id);
    if (!current || ctx.message.text.startsWith('/')) return next();
    const question = debriefQuestions[current.index];
    if (!question) return next();
    current.answers[question[0]] = ctx.message.text.trim();
    current.index += 1;
    const following = debriefQuestions[current.index];
    if (following) {
      await ctx.reply(following[1]);
      return;
    }
    await dependencies.store.saveAttendanceDebrief({
      ownerUserId: BigInt(ctx.from.id),
      attendanceId: current.attendanceId,
      ...(current.answers.notes ? { notes: current.answers.notes } : {}),
      ...(current.answers.highlights
        ? { highlights: current.answers.highlights }
        : {}),
      ...(current.answers.lessons ? { lessons: current.answers.lessons } : {}),
    });
    debriefs.delete(ctx.from.id);
    await ctx.reply('✅ Debrief byl uložen soukromě.');
  });
  if (dependencies.contacts)
    registerNetworkHandlers(bot, dependencies.contacts);
  bot.catch((error) => dependencies.reportError(error.error));
  return bot;
};
