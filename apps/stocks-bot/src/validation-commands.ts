import type { ValidationStore } from '@watcher/database';
import {
  commandArgument,
  formatRunDuration,
  renderBacktestSummary,
  renderCalibration,
  renderEventReplay,
  renderHistoricalReplay,
  renderSignalPerformance,
  sendSplitMessage,
  stockSymbolSchema,
} from '@watcher/telegram';
import type { Bot } from 'grammy';

type ChatConfiguration = {
  id: string;
  watcherConfig: { id: string } | null;
};

const parseTimestamp = (raw: string, endOfDay = false): Date => {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? `${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
    : raw;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid timestamp: ${raw}`);
  }
  return parsed;
};

export const registerValidationCommands = (
  bot: Bot,
  validation: ValidationStore,
  minimumSampleSize: number,
  getChat: (chatId: number) => Promise<ChatConfiguration>,
): void => {
  bot.command('replay', async (ctx) => {
    const [rawSymbol, rawTimestamp, ...extra] = commandArgument(
      ctx.message?.text,
    ).split(/\s+/);
    if (!rawSymbol || !rawTimestamp || extra.length) {
      await ctx.reply('Usage: /replay SYMBOL YYYY-MM-DD or ISO_TIMESTAMP');
      return;
    }
    const symbol = stockSymbolSchema.parse(rawSymbol);
    const current = await getChat(ctx.chat.id);
    const replay = await validation.analyzeAsOf(
      current.id,
      symbol,
      parseTimestamp(rawTimestamp, true),
    );
    if (!replay) {
      await ctx.reply(`${symbol} is not in this chat's watchlist.`);
      return;
    }
    await sendSplitMessage(
      ctx.api,
      BigInt(ctx.chat.id),
      renderHistoricalReplay(replay),
    );
  });

  bot.command(['event_replay', 'eventreplay'], async (ctx) => {
    const [rawSymbol, rawFrom, rawTo, ...extra] = commandArgument(
      ctx.message?.text,
    ).split(/\s+/);
    if (!rawSymbol || extra.length) {
      await ctx.reply(
        'Usage: /event_replay SYMBOL [FROM_DATE_OR_ISO] [TO_DATE_OR_ISO]',
      );
      return;
    }
    const symbol = stockSymbolSchema.parse(rawSymbol);
    const current = await getChat(ctx.chat.id);
    const replay = await validation.replayEvents(
      current.id,
      symbol,
      rawFrom ? parseTimestamp(rawFrom) : null,
      rawTo ? parseTimestamp(rawTo, true) : new Date(),
    );
    if (!replay) {
      await ctx.reply(`${symbol} is not in this chat's watchlist.`);
      return;
    }
    await sendSplitMessage(
      ctx.api,
      BigInt(ctx.chat.id),
      renderEventReplay(replay),
    );
  });

  bot.command('validate', async (ctx) => {
    const current = await getChat(ctx.chat.id);
    const progress = await ctx.reply(
      '🧪 Replaying stored signals and matching real price outcomes…',
    );
    const result = await validation.runValidation(current.watcherConfig!.id);
    const message =
      result.status === 'BUSY'
        ? 'A validation run is already in progress.'
        : result.status === 'FAILED'
          ? `Validation failed after ${formatRunDuration(result.durationMs)}: ${result.error}`
          : `Validation complete in ${formatRunDuration(result.durationMs)}. ${result.targetCount} targets evaluated; ${result.outcomeCount} have a real stored anchor price. Use /backtest, /calibration, and /signal_performance for results.`;
    await ctx.api.editMessageText(ctx.chat.id, progress.message_id, message);
  });

  bot.command('backtest', async (ctx) => {
    const current = await getChat(ctx.chat.id);
    await sendSplitMessage(
      ctx.api,
      BigInt(ctx.chat.id),
      renderBacktestSummary(
        await validation.getBacktestSummary(current.watcherConfig!.id),
      ),
    );
  });

  bot.command('calibration', async (ctx) => {
    const current = await getChat(ctx.chat.id);
    await ctx.reply(
      renderCalibration(
        await validation.getCalibration(current.watcherConfig!.id),
      ),
      { parse_mode: 'HTML' },
    );
  });

  bot.command(['signal_performance', 'signalperformance'], async (ctx) => {
    const current = await getChat(ctx.chat.id);
    await sendSplitMessage(
      ctx.api,
      BigInt(ctx.chat.id),
      renderSignalPerformance(
        await validation.getSignalPerformance(
          current.watcherConfig!.id,
          minimumSampleSize,
        ),
        minimumSampleSize,
      ),
    );
  });
};
