import {
  monitoringModeSchema,
  monitoringTierSchema,
  type CompanyUniverseManager,
} from './core/index.js';
import {
  StockSourceType,
  type DiscoveryStatus,
  type WatcherStore,
  type ValidationStore,
} from '@watcher/database';
import {
  authorizationMiddleware,
  commandArgument,
  formatRunDuration,
  renderCatalystList,
  renderAdvancedStockData,
  renderOpportunityFeed,
  renderRecentStockAlerts,
  renderRunProgress,
  renderStockDashboard,
  renderStockSourceList,
  renderStockThesis,
  renderWatcherHealth,
  sendSplitMessage,
  stockSymbolSchema,
} from '@watcher/telegram';
import { Bot, InlineKeyboard } from 'grammy';
import { z } from 'zod';
import {
  errorMessage,
  stockThesisStateSchema,
  type ProgressReporter,
  type RunExecution,
} from '@watcher/core';
import type { DiscoveryExecution } from './discovery.js';
import { registerValidationCommands } from './validation-commands.js';
import { scheduleExample, stocksAbout, stocksHelp } from './copy.js';
import { renderStockList, type StockListEntry } from './stock-list.js';

type StockCompany = {
  symbol: string;
  companyName: string;
  cik: string;
  exchange: string | null;
  industry: string | null;
  investorRelationsUrl: string | null;
};
type StockCompanyLookup = (symbol: string) => Promise<StockCompany>;
const renderDiscoveryStatus = (
  status: DiscoveryStatus,
  enabled: boolean,
): string => {
  const investigations = status.investigations.length
    ? status.investigations
        .map((entry) => {
          const company = entry.companyName
            ? `${entry.ticker} — ${entry.companyName}`
            : entry.ticker;
          const until = entry.investigateUntil?.toISOString() ?? 'no timeout';
          return `• ${company} · attention ${entry.attentionScore} · until ${until}${entry.reason ? `\n  ${entry.reason}` : ''}`;
        })
        .join('\n')
    : 'None.';
  const signals = status.recentSignals.length
    ? status.recentSignals
        .map(
          (entry) =>
            `• ${entry.ticker} · ${entry.changePercent >= 0 ? '+' : ''}${entry.changePercent.toFixed(2)}% · ${entry.volume.toLocaleString('en-US')} shares · ${entry.status}`,
        )
        .join('\n')
    : 'None.';
  return `🔎 Discovery scanner: ${enabled ? 'enabled' : 'not configured'}${status.scanInProgress ? ' · scan running' : ''}\nLast scan: ${status.lastScanAt?.toISOString() ?? 'never'}\nNext scan: ${enabled ? (status.nextScanAt?.toISOString() ?? 'not scheduled') : 'disabled'}\n\nInvestigations\n${investigations}\n\nRecent signals\n${signals}`;
};

export const createStocksBot = (
  token: string,
  allowedIds: ReadonlySet<number>,
  store: WatcherStore,
  validation: ValidationStore,
  validationMinimumSampleSize: number,
  universe: CompanyUniverseManager,
  runNow: (
    configId: string,
    chatId: bigint,
    options?: { onProgress?: ProgressReporter },
  ) => Promise<RunExecution>,
  lookupCompany: StockCompanyLookup,
  discoveryEnabled: boolean,
  runDiscovery: (
    configId: string,
    chatId: bigint,
  ) => Promise<DiscoveryExecution>,
  getDiscoveryStatus: (chatConfigId: string) => Promise<DiscoveryStatus>,
  reconcileNow: (configId: string, chatId: bigint) => Promise<RunExecution>,
  timezone: string,
  reportError: (error: unknown) => void,
): Bot => {
  const bot = new Bot(token);
  bot.use(authorizationMiddleware(allowedIds));

  const chat = async (chatId: number) =>
    store.ensureChat('STOCKS', BigInt(chatId), timezone);
  registerValidationCommands(
    bot,
    validation,
    validationMinimumSampleSize,
    chat,
  );
  const withCompany = async (
    stock: StockListEntry,
  ): Promise<StockListEntry> => {
    if (stock.companyName && stock.cik) {
      return stock;
    }
    try {
      const company = await lookupCompany(stock.symbol);
      const updated = await store.updateStockCompany(stock.id, {
        companyName: company.companyName,
        cik: company.cik,
        exchange: company.exchange,
        industry: company.industry,
        investorRelationsUrl: company.investorRelationsUrl,
      });
      return updated;
    } catch {
      return stock;
    }
  };
  bot.command(['start', 'help'], async (ctx) => {
    await chat(ctx.chat.id);
    await ctx.reply(`📈 Stocks Watcher\n\n${stocksHelp}`);
  });
  bot.command('about', async (ctx) => {
    await chat(ctx.chat.id);
    await ctx.reply(stocksAbout, {
      parse_mode: 'Markdown',
      link_preview_options: { is_disabled: true },
    });
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
    await sendSplitMessage(
      ctx.api,
      BigInt(ctx.chat.id),
      renderStockList(stocks),
    );
  });
  bot.command('dashboard', async (ctx) => {
    const current = await chat(ctx.chat.id);
    await sendSplitMessage(
      ctx.api,
      BigInt(ctx.chat.id),
      renderStockDashboard(await store.getStockDashboard(current.id)),
    );
  });
  bot.command('opportunities', async (ctx) => {
    const current = await chat(ctx.chat.id);
    await sendSplitMessage(
      ctx.api,
      BigInt(ctx.chat.id),
      renderOpportunityFeed(await store.getStockDashboard(current.id)),
    );
  });
  bot.command('alerts', async (ctx) => {
    const current = await chat(ctx.chat.id);
    await sendSplitMessage(
      ctx.api,
      BigInt(ctx.chat.id),
      renderRecentStockAlerts(await store.listRecentAlerts(current.id)),
    );
  });
  bot.command('health', async (ctx) => {
    const current = await chat(ctx.chat.id);
    await sendSplitMessage(
      ctx.api,
      BigInt(ctx.chat.id),
      renderWatcherHealth(
        await store.getObservabilitySnapshot(current.watcherConfig!.id),
      ),
    );
  });
  bot.command('thesis', async (ctx) => {
    const symbol = stockSymbolSchema.parse(commandArgument(ctx.message?.text));
    const thesis = await store.getStockThesis(symbol);
    if (!thesis) {
      await ctx.reply(
        `No thesis exists for ${symbol} yet. Run the watcher after a material event is detected.`,
      );
      return;
    }
    const parsed = stockThesisStateSchema.parse({
      ticker: thesis.ticker,
      thesis: thesis.thesis,
      verdict: thesis.verdict,
      confidence: thesis.confidence,
      attentionScore: thesis.attentionScore,
      bullScore: thesis.bullScore,
      bearScore: thesis.bearScore,
      netSignal: thesis.netSignal,
      signalGroups: thesis.signalGroups,
      catalysts: thesis.catalysts,
      insiderConviction: thesis.insiderConviction,
      pricedIn: thesis.pricedIn,
      primaryDrivers: thesis.primaryDrivers,
      risks: thesis.risks,
      dataCoverage: thesis.dataCoverage,
      dataQuality: thesis.dataQuality,
      materialDataGaps: thesis.materialDataGaps,
      decision: thesis.decision,
    });
    await ctx.reply(renderStockThesis(parsed), {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  });
  bot.command('discovery', async (ctx) => {
    const current = await chat(ctx.chat.id);
    await ctx.reply(
      renderDiscoveryStatus(
        await getDiscoveryStatus(current.id),
        discoveryEnabled,
      ),
    );
  });
  bot.command('rundiscovery', async (ctx) => {
    const current = await chat(ctx.chat.id);
    if (!discoveryEnabled) {
      await ctx.reply(
        'Discovery is disabled. Configure ALPHA_VANTAGE_API_KEY on the server.',
      );
      return;
    }
    const progress = await ctx.reply('🔎 Scanning the market for candidates…');
    const result = await runDiscovery(
      current.watcherConfig!.id,
      BigInt(ctx.chat.id),
    );
    const message =
      result.status === 'BUSY'
        ? 'A discovery scan is already running.'
        : result.status === 'FAILED'
          ? `Discovery scan failed after ${formatRunDuration(result.durationMs)}: ${result.error}`
          : `Discovery scan complete in ${formatRunDuration(result.durationMs)}. Observed ${result.observedCount}, selected ${result.candidateCount}, activated ${result.activatedTickers.length}${result.activatedTickers.length ? ` (${result.activatedTickers.join(', ')})` : ''}, rejected ${result.rejectedCount}.`;
    await ctx.api.editMessageText(ctx.chat.id, progress.message_id, message);
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
    await universe.addCompany({
      chatConfigId: current.id,
      ticker: company.symbol,
      companyName: company.companyName,
      cik: company.cik,
      exchange: company.exchange,
      industry: company.industry,
      investorRelationsUrl: company.investorRelationsUrl,
    });
    await ctx.reply(
      `${company.symbol} — ${company.companyName} added. All stock sources are enabled.`,
    );
  });
  bot.command('settier', async (ctx) => {
    const argument = commandArgument(ctx.message?.text);
    const [rawSymbol, rawTier, possibleDate, ...reasonParts] =
      argument.split(/\s+/);
    const symbol = stockSymbolSchema.parse(rawSymbol);
    const monitoringTier = monitoringTierSchema.parse(rawTier?.toUpperCase());
    const hasDate = /^\d{4}-\d{2}-\d{2}$/.test(possibleDate ?? '');
    const watchUntil = hasDate
      ? z.coerce.date().parse(`${possibleDate}T23:59:59.999Z`)
      : undefined;
    const watchReason = [
      ...(hasDate || !possibleDate ? [] : [possibleDate]),
      ...reasonParts,
    ]
      .filter((value): value is string => Boolean(value))
      .join(' ');
    const current = await chat(ctx.chat.id);
    const updated = await universe.updateState(current.id, symbol, {
      monitoringTier,
      ...(monitoringTier === 'DISCOVERY'
        ? {
            monitoringMode: 'LOW_RESOLUTION' as const,
            attentionScore: 0,
            watchUntil: null,
            watchStartedAt: null,
            watchReason: null,
            investigationStartedAt: null,
            investigateUntil: null,
            highResolutionUntil: null,
            nextHighResolutionCheckAt: null,
          }
        : {}),
      ...(watchUntil ? { watchUntil } : {}),
      ...(watchReason && monitoringTier !== 'DISCOVERY' ? { watchReason } : {}),
    });
    await ctx.reply(`${updated.ticker} tier set to ${updated.monitoringTier}.`);
  });
  bot.command('setmode', async (ctx) => {
    const [rawSymbol, rawMode] = commandArgument(ctx.message?.text).split(
      /\s+/,
    );
    const symbol = stockSymbolSchema.parse(rawSymbol);
    const monitoringMode = monitoringModeSchema.parse(rawMode?.toUpperCase());
    const current = await chat(ctx.chat.id);
    const updated = await universe.updateState(current.id, symbol, {
      monitoringMode,
    });
    await ctx.reply(
      `${updated.ticker} monitoring mode set to ${updated.monitoringMode}.`,
    );
  });
  bot.command('setpriority', async (ctx) => {
    const [rawSymbol, rawPriority] = commandArgument(ctx.message?.text).split(
      /\s+/,
    );
    const symbol = stockSymbolSchema.parse(rawSymbol);
    const priority = z.coerce.number().int().min(0).max(100).parse(rawPriority);
    const current = await chat(ctx.chat.id);
    const updated = await universe.updateState(current.id, symbol, {
      priority,
    });
    await ctx.reply(`${updated.ticker} priority set to ${updated.priority}.`);
  });
  const setStockEnabled = async (
    chatId: number,
    rawText: string | undefined,
    enabled: boolean,
  ): Promise<string> => {
    const symbol = stockSymbolSchema.parse(commandArgument(rawText));
    const current = await chat(chatId);
    const updated = await universe.updateState(current.id, symbol, { enabled });
    return `${updated.ticker} monitoring ${enabled ? 'enabled' : 'disabled'}.`;
  };
  bot.command('stockon', async (ctx) => {
    await ctx.reply(
      await setStockEnabled(ctx.chat.id, ctx.message?.text, true),
    );
  });
  bot.command('stockoff', async (ctx) => {
    await ctx.reply(
      await setStockEnabled(ctx.chat.id, ctx.message?.text, false),
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
    if (!stocks.length) {
      return ctx.reply('Add a stock first.');
    }
    for (const stock of stocks) {
      const keyboard = new InlineKeyboard();
      const sourceTypes = Object.values(StockSourceType);
      stock.sources.forEach((source) => {
        const sourceIndex = sourceTypes.indexOf(source.source);
        keyboard
          .text(
            `${source.enabled ? '✅' : '❌'} ${source.source}`,
            `ss:${stock.id}:${sourceIndex}`,
          )
          .row();
      });
      await ctx.reply(`${stock.symbol} sources`, { reply_markup: keyboard });
    }
  });
  bot.command('listsources', async (ctx) => {
    await ctx.reply(renderStockSourceList(), {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  });
  bot.command('catalysts', async (ctx) => {
    const current = await chat(ctx.chat.id);
    const argument = commandArgument(ctx.message?.text);
    const symbol = argument
      ? stockSymbolSchema.parse(argument.trim().toUpperCase())
      : undefined;
    await ctx.reply(
      renderCatalystList(await store.listCatalysts(current.id, symbol)),
      {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      },
    );
  });
  bot.command('advanced', async (ctx) => {
    const current = await chat(ctx.chat.id);
    const argument = commandArgument(ctx.message?.text);
    const symbol = argument
      ? stockSymbolSchema.parse(argument.trim().toUpperCase())
      : undefined;
    await sendSplitMessage(
      ctx.api,
      BigInt(ctx.chat.id),
      renderAdvancedStockData(
        await store.getAdvancedStockData(current.id, symbol),
      ),
    );
  });
  bot.callbackQuery(/^ss:([^:]+):(.+)$/, async (ctx) => {
    const [, stockId, sourceToken] = ctx.match;
    if (!stockId || !sourceToken) {
      return;
    }
    const sourceTypes = Object.values(StockSourceType);
    const source = /^\d+$/.test(sourceToken)
      ? sourceTypes[Number(sourceToken)]
      : z.enum(StockSourceType).parse(sourceToken);
    if (!source) return ctx.answerCallbackQuery('Unknown source');
    await store.toggleStockSource(stockId, source);
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
      if (text === lastProgress) {
        return;
      }
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
  bot.command('reconcile', async (ctx) => {
    const current = await chat(ctx.chat.id);
    const progress = await ctx.reply(
      '🔄 Running comprehensive reconciliation across all configured sources…',
    );
    const result = await reconcileNow(
      current.watcherConfig!.id,
      BigInt(ctx.chat.id),
    );
    if (result.status === 'BUSY') {
      await ctx.api.editMessageText(
        ctx.chat.id,
        progress.message_id,
        'A run or reconciliation is already in progress.',
      );
    } else if (result.status === 'FAILED') {
      await ctx.api.editMessageText(
        ctx.chat.id,
        progress.message_id,
        `Reconciliation failed after ${formatRunDuration(result.durationMs)}: ${result.error}`,
      );
    } else {
      await ctx.api.editMessageText(
        ctx.chat.id,
        progress.message_id,
        `Reconciliation complete in ${formatRunDuration(result.result.durationMs ?? 0)}. ${result.result.newItemCount} new items, ${result.result.sourceFailures.length} source errors.`,
      );
    }
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
