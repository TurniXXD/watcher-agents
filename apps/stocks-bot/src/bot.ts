import { StockSourceType, type WatcherStore } from '@watcher/database';
import {
  authorizationMiddleware,
  commandArgument,
  formatRunDuration,
  renderStockSourceList,
  renderRunProgress,
  stockSymbolSchema,
} from '@watcher/telegram';
import { Bot, InlineKeyboard } from 'grammy';
import { z } from 'zod';
import type { ProgressReporter, RunExecution } from '@watcher/core';

type StockCompany = { symbol: string; companyName: string; cik: string };
type StockCompanyLookup = (symbol: string) => Promise<StockCompany>;
type StockListEntry = {
  id: string;
  symbol: string;
  companyName: string | null;
  cik: string | null;
};

const scheduleExample = '/schedule 0 8 * * * Europe/Prague';

const help = `/help — show this command list
/status — watcher status
/stocks — list stocks
/addstock SYMBOL — add a stock (all sources enabled by default)
/removestock SYMBOL — remove a stock
/sources — configure SEC, FINVIZ, Zacks, Earnings Whispers, and price
/listsources — list available sources and provider links
/schedule [CRON] [TIMEZONE] — view or update schedule
  Example: ${scheduleExample}
/run — run now
/pause — pause scheduled runs
/resume — resume scheduled runs`;

const stockDisplayName = (stock: StockListEntry): string =>
  stock.companyName ? `${stock.symbol} — ${stock.companyName}` : stock.symbol;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const createStocksBot = (
  token: string,
  allowedIds: ReadonlySet<number>,
  store: WatcherStore,
  runNow: (
    configId: string,
    chatId: bigint,
    options?: { onProgress?: ProgressReporter },
  ) => Promise<RunExecution>,
  lookupCompany: StockCompanyLookup,
  timezone: string,
  reportError: (error: unknown) => void,
): Bot => {
  const bot = new Bot(token);
  bot.use(authorizationMiddleware(allowedIds));

  const chat = async (chatId: number) =>
    store.ensureChat('STOCKS', BigInt(chatId), timezone);
  const withCompany = async (
    stock: StockListEntry,
  ): Promise<StockListEntry> => {
    if (stock.companyName && stock.cik) return stock;
    try {
      const company = await lookupCompany(stock.symbol);
      const updated = await store.updateStockCompany(stock.id, {
        companyName: company.companyName,
        cik: company.cik,
      });
      return updated;
    } catch {
      return stock;
    }
  };
  bot.command(['start', 'help'], async (ctx) => {
    await chat(ctx.chat.id);
    await ctx.reply(`📈 Stocks Watcher\n\n${help}`);
  });
  bot.command('status', async (ctx) => {
    const current = await chat(ctx.chat.id);
    const config = current.watcherConfig;
    await ctx.reply(
      `Status: ${config?.enabled ? 'running' : 'paused'}\nSchedule: ${config?.schedule} (${config?.timezone})\nNext: ${config?.nextRunAt?.toISOString() ?? 'not scheduled'}\nLast: ${config?.lastRunStatus ?? 'never'}`,
    );
  });
  bot.command('stocks', async (ctx) => {
    const current = await chat(ctx.chat.id);
    const stocks = await Promise.all(
      (await store.listStocks(current.id)).map(withCompany),
    );
    await ctx.reply(
      stocks.length
        ? stocks.map((stock) => stockDisplayName(stock)).join('\n')
        : 'No stocks configured.',
    );
  });
  bot.command('addstock', async (ctx) => {
    const symbol = stockSymbolSchema.parse(commandArgument(ctx.message?.text));
    const current = await chat(ctx.chat.id);
    let company: StockCompany;
    try {
      company = await lookupCompany(symbol);
    } catch (error) {
      await ctx.reply(
        `Could not resolve ${symbol} through SEC EDGAR: ${errorMessage(error)}`,
      );
      return;
    }
    await store.addStock(current.id, company.symbol, {
      companyName: company.companyName,
      cik: company.cik,
    });
    await ctx.reply(
      `${company.symbol} — ${company.companyName} added. All stock sources are enabled.`,
    );
  });
  bot.command('removestock', async (ctx) => {
    const symbol = stockSymbolSchema.parse(commandArgument(ctx.message?.text));
    const current = await chat(ctx.chat.id);
    const result = await store.removeStock(current.id, symbol);
    await ctx.reply(
      result.count ? `${symbol} removed.` : `${symbol} was not configured.`,
    );
  });
  bot.command('sources', async (ctx) => {
    const current = await chat(ctx.chat.id);
    const stocks = await store.listStocks(current.id);
    if (!stocks.length) return ctx.reply('Add a stock first.');
    for (const stock of stocks) {
      const keyboard = new InlineKeyboard();
      stock.sources
        .filter(
          (source) =>
            source.source !== StockSourceType.INVESTOR_RELATIONS &&
            source.source !== StockSourceType.NEWS,
        )
        .forEach((source) =>
          keyboard
            .text(
              `${source.enabled ? '✅' : '❌'} ${source.source}`,
              `ss:${stock.id}:${source.source}`,
            )
            .row(),
        );
      await ctx.reply(`${stock.symbol} sources`, { reply_markup: keyboard });
    }
  });
  bot.command('listsources', async (ctx) => {
    await ctx.reply(renderStockSourceList(), {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  });
  bot.callbackQuery(/^ss:([^:]+):(.+)$/, async (ctx) => {
    const [, stockId, source] = ctx.match;
    if (!stockId || !source) return;
    await store.toggleStockSource(
      stockId,
      z.enum(StockSourceType).parse(source),
    );
    await ctx.answerCallbackQuery('Updated');
    await ctx.editMessageReplyMarkup();
  });
  bot.command('schedule', async (ctx) => {
    const current = await chat(ctx.chat.id);
    const argument = commandArgument(ctx.message?.text);
    if (!argument)
      return ctx.reply(
        `Current schedule: ${current.watcherConfig?.schedule} ${current.watcherConfig?.timezone}\nExample: ${scheduleExample}`,
      );
    const parts = argument.split(/\s+/);
    const selectedTimezone = parts.at(-1)?.includes('/')
      ? parts.pop()
      : current.watcherConfig?.timezone;
    await store.updateSchedule(
      current.watcherConfig!.id,
      parts.join(' '),
      selectedTimezone ?? timezone,
    );
    await ctx.reply('Schedule updated.');
  });
  bot.command('run', async (ctx) => {
    const current = await chat(ctx.chat.id);
    const initialProgress = renderRunProgress({
      percent: 0,
      step: 'Starting',
    });
    const progressMessage = await ctx.reply(initialProgress);
    let lastProgress = initialProgress;
    const onProgress: ProgressReporter = async (progress) => {
      const text = renderRunProgress(progress);
      if (text === lastProgress) return;
      lastProgress = text;
      await ctx.api.editMessageText(
        ctx.chat.id,
        progressMessage.message_id,
        text,
      );
    };
    const result = await runNow(
      current.watcherConfig!.id,
      BigInt(ctx.chat.id),
      { onProgress },
    );
    if (result.status === 'BUSY')
      await ctx.api.editMessageText(
        ctx.chat.id,
        progressMessage.message_id,
        'A run is already in progress.',
      );
    if (result.status === 'FAILED')
      await ctx.api.editMessageText(
        ctx.chat.id,
        progressMessage.message_id,
        `Run failed after ${formatRunDuration(result.durationMs)}: ${result.error}`,
      );
  });
  bot.command('pause', async (ctx) => {
    const current = await chat(ctx.chat.id);
    await store.setEnabled(current.watcherConfig!.id, false);
    await ctx.reply('Scheduled runs paused.');
  });
  bot.command('resume', async (ctx) => {
    const current = await chat(ctx.chat.id);
    await store.setEnabled(current.watcherConfig!.id, true);
    await ctx.reply('Scheduled runs resumed.');
  });
  bot.catch((error) => reportError(error.error));
  return bot;
};
