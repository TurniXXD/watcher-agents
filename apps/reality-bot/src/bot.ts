import { computeNextRun } from '@watcher/core';
import type { RealityStore } from '@watcher/database';
import {
  authorizationMiddleware,
  commandArgument,
  sendSplitMessage,
} from '@watcher/telegram';
import { Bot } from 'grammy';
import { investmentModelSchema, type EvaluatedListing } from './types.js';
import type { RunResult } from './service.js';
import { renderOpportunityAlert, renderRealityReport } from './report.js';

export type RealityDefaults = {
  timezone: string;
  schedule: string;
  locations: readonly string[];
};

const help = [
  '/status – stav, lokality, plán a poslední běh',
  '/run – načíst data a poslat market report ihned',
  '/pause, /resume – vypnout nebo zapnout reporty a alerty',
  '/schedule CRON TIMEZONE – měsíční plán reportu',
  '/locations – sledované lokality',
  '/location_add MĚSTO, /location_remove MĚSTO',
  '/model – standardizovaný model hypotéky a nákladů',
  '/model CENA EQUITY_% LET VACANCY_% – upravit hlavní předpoklady',
  '',
  'Výjimečná nabídka se pošle okamžitě; market report standardně 1. den v měsíci.',
].join('\n');

export const createRealityBot = (
  token: string,
  allowedUserIds: ReadonlySet<number>,
  store: RealityStore,
  runNow: (chatId: bigint) => Promise<RunResult>,
  defaults: RealityDefaults,
  reportError: (error: unknown) => void,
): Bot => {
  const bot = new Bot(token);
  bot.use(authorizationMiddleware(allowedUserIds));
  const user = (chatId: number) =>
    store.ensureUser(
      BigInt(chatId),
      defaults.timezone,
      defaults.schedule,
      defaults.locations,
    );

  bot.command(['start', 'help'], async (context) => {
    await user(context.chat.id);
    await context.reply(`🏠 Reality Investment Analyst\n\n${help}`);
  });
  bot.command('about', async (context) => {
    await context.reply(
      'Reality Bot sleduje financování, makro, ceny, nájmy, nabídku a konkrétní investiční příležitosti. Výpočty jsou odhady, ne investiční ani úvěrové doporučení.',
    );
  });
  bot.command('status', async (context) => {
    const current = await user(context.chat.id);
    await context.reply(
      [
        `Status: ${current.enabled ? 'běží' : 'pozastaveno'}`,
        `Report: ${current.reportSchedule} (${current.timezone})`,
        `Další report: ${current.nextReportAt.toISOString()}`,
        `Poslední report: ${current.lastReportAt?.toISOString() ?? 'zatím žádný'}`,
        `Poslední stav: ${current.lastRunStatus ?? 'zatím žádný'}`,
        `Lokality: ${current.locations.join(', ')}`,
        `Alert: gross yield ≥ ${Number(current.alertGrossYieldPercent)} %, cena ≥ ${Number(current.alertDiscountPercent)} % pod lokálním Kč/m², kladné CF při ${Number(current.alertCashflowRate)} %`,
      ].join('\n'),
    );
  });
  bot.command('run', async (context) => {
    await user(context.chat.id);
    const pending = await context.reply('⏳ Načítám trh a počítám report…');
    const result = await runNow(BigInt(context.chat.id));
    if (result.status === 'BUSY') {
      await context.api.editMessageText(
        context.chat.id,
        pending.message_id,
        'Jiný běh už probíhá.',
      );
      return;
    }
    if (result.status === 'FAILED') {
      await context.api.editMessageText(
        context.chat.id,
        pending.message_id,
        `Běh selhal: ${result.error}`,
      );
      return;
    }
    await context.api.deleteMessage(context.chat.id, pending.message_id);
    const current = await user(context.chat.id);
    const model = investmentModelSchema.parse(current.model);
    await sendSplitMessage(
      context.api,
      BigInt(context.chat.id),
      renderRealityReport(result.payload, current.locations, model),
    );
  });
  bot.command('pause', async (context) => {
    const current = await user(context.chat.id);
    await store.setEnabled(current.id, false);
    await context.reply('Měsíční reporty a průběžné alerty jsou pozastavené.');
  });
  bot.command('resume', async (context) => {
    const current = await user(context.chat.id);
    await store.setEnabled(current.id, true);
    await context.reply('Měsíční reporty a průběžné alerty znovu běží.');
  });
  bot.command('schedule', async (context) => {
    const current = await user(context.chat.id);
    const argument = commandArgument(context.message?.text);
    if (!argument) {
      await context.reply(
        `Aktuální plán: ${current.reportSchedule} ${current.timezone}\nPříklad: /schedule 0 8 1 * * Europe/Prague`,
      );
      return;
    }
    const parts = argument.split(/\s+/u);
    const candidateTimezone = parts.at(-1);
    const timezone = candidateTimezone?.includes('/')
      ? parts.pop()!
      : current.timezone;
    const schedule = parts.join(' ');
    try {
      computeNextRun(schedule, timezone);
      await store.updateSchedule(current.id, schedule, timezone);
      await context.reply('Plán měsíčního reportu byl uložen.');
    } catch {
      await context.reply(
        'Neplatný cron nebo timezone. Příklad: /schedule 0 8 1 * * Europe/Prague',
      );
    }
  });
  bot.command('locations', async (context) => {
    const current = await user(context.chat.id);
    await context.reply(
      `Sledované lokality:\n${current.locations.map((item) => `• ${item}`).join('\n')}`,
    );
  });
  bot.command(['location_add', 'location_remove'], async (context) => {
    const location = commandArgument(context.message?.text).trim();
    if (location.length < 2 || location.length > 120) {
      await context.reply(
        'Použití: /location_add MĚSTO nebo /location_remove MĚSTO',
      );
      return;
    }
    const current = await user(context.chat.id);
    const removing =
      context.message?.text?.startsWith('/location_remove') === true;
    const locations = removing
      ? current.locations.filter(
          (item) =>
            item.toLocaleLowerCase('cs') !== location.toLocaleLowerCase('cs'),
        )
      : current.locations.some(
            (item) =>
              item.toLocaleLowerCase('cs') === location.toLocaleLowerCase('cs'),
          )
        ? current.locations
        : [...current.locations, location];
    if (locations.length === 0) {
      await context.reply('Musí zůstat alespoň jedna sledovaná lokalita.');
      return;
    }
    await store.updateLocations(current.id, locations);
    await context.reply(`Lokality: ${locations.join(', ')}`);
  });
  bot.command('model', async (context) => {
    const current = await user(context.chat.id);
    const argument = commandArgument(context.message?.text);
    const existing = investmentModelSchema.parse(current.model);
    if (!argument) {
      await context.reply(
        [
          `Kupní cena: ${existing.purchasePriceCzk} Kč`,
          `Modelová plocha: ${existing.floorAreaM2} m²`,
          `Equity: ${existing.equityPercent} %`,
          `Splatnost: ${existing.termYears} let`,
          `Vacancy: ${existing.vacancyPercent} %`,
          `Údržba: ${existing.annualMaintenancePercent} % ceny ročně`,
          `Pojištění: ${existing.annualInsuranceCzk} Kč ročně`,
          '',
          'Změna: /model CENA EQUITY_% LET VACANCY_%',
        ].join('\n'),
      );
      return;
    }
    const values = argument.split(/\s+/u).map(Number);
    const parsed = investmentModelSchema.safeParse({
      ...existing,
      purchasePriceCzk: values[0],
      equityPercent: values[1],
      termYears: values[2],
      vacancyPercent: values[3],
    });
    if (!parsed.success || values.length !== 4) {
      await context.reply('Neplatné hodnoty. Příklad: /model 3000000 30 30 5');
      return;
    }
    await store.updateModel(current.id, parsed.data);
    await context.reply('Investiční model byl uložen.');
  });
  bot.catch((error) => reportError(error.error));
  return bot;
};

export const sendRealityAlert = async (
  bot: Bot,
  chatId: bigint,
  listing: EvaluatedListing,
): Promise<void> =>
  sendSplitMessage(bot.api, chatId, renderOpportunityAlert(listing));
