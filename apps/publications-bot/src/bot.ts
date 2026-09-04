import type { RunExecution } from '@watcher/core';
import { PublicationSourceType, type WatcherStore } from '@watcher/database';
import {
  authorizationMiddleware,
  commandArgument,
  formatRunDuration,
  publicationQuerySchema,
} from '@watcher/telegram';
import { Bot, InlineKeyboard } from 'grammy';
import { z } from 'zod';

const help = `/status — watcher status
/queries — list topics
/addquery TOPIC — add a topic (PubMed enabled by default)
/removequery TOPIC — remove a topic
/sources — configure sources with buttons
/schedule [CRON] [TIMEZONE] — view or update schedule
/run — run now
/pause — pause scheduled runs
/resume — resume scheduled runs`;

export const createPublicationsBot = (
  token: string,
  allowedIds: ReadonlySet<number>,
  store: WatcherStore,
  runNow: (configId: string, chatId: bigint) => Promise<RunExecution>,
  timezone: string,
  reportError: (error: unknown) => void,
): Bot => {
  const bot = new Bot(token);
  bot.use(authorizationMiddleware(allowedIds));
  const chat = async (chatId: number) =>
    store.ensureChat('PUBLICATIONS', BigInt(chatId), timezone);
  bot.command(['start', 'help'], async (ctx) => {
    await chat(ctx.chat.id);
    await ctx.reply(`🧬 Publications Watcher\n\n${help}`);
  });
  bot.command('status', async (ctx) => {
    const current = await chat(ctx.chat.id);
    const config = current.watcherConfig;
    await ctx.reply(
      `Status: ${config?.enabled ? 'running' : 'paused'}\nSchedule: ${config?.schedule} (${config?.timezone})\nNext: ${config?.nextRunAt?.toISOString() ?? 'not scheduled'}\nLast: ${config?.lastRunStatus ?? 'never'}`,
    );
  });
  bot.command('queries', async (ctx) => {
    const current = await chat(ctx.chat.id);
    const queries = await store.listQueries(current.id);
    await ctx.reply(
      queries.length
        ? queries.map((entry) => entry.query).join('\n')
        : 'No queries configured.',
    );
  });
  bot.command('addquery', async (ctx) => {
    const query = publicationQuerySchema.parse(
      commandArgument(ctx.message?.text),
    );
    const current = await chat(ctx.chat.id);
    await store.addQuery(current.id, query);
    await ctx.reply(`“${query}” added. PubMed is enabled.`);
  });
  bot.command('removequery', async (ctx) => {
    const query = publicationQuerySchema.parse(
      commandArgument(ctx.message?.text),
    );
    const current = await chat(ctx.chat.id);
    const result = await store.removeQuery(current.id, query);
    await ctx.reply(
      result.count ? 'Query removed.' : 'Query was not configured.',
    );
  });
  bot.command('sources', async (ctx) => {
    const current = await chat(ctx.chat.id);
    const queries = await store.listQueries(current.id);
    if (!queries.length) return ctx.reply('Add a query first.');
    for (const query of queries) {
      const keyboard = new InlineKeyboard();
      query.sources.forEach((source) =>
        keyboard
          .text(
            `${source.enabled ? '✅' : '❌'} ${source.source}`,
            `ps:${query.id}:${source.source}`,
          )
          .row(),
      );
      await ctx.reply(`Sources for “${query.query}”`, {
        reply_markup: keyboard,
      });
    }
  });
  bot.callbackQuery(/^ps:([^:]+):(.+)$/, async (ctx) => {
    const [, queryId, source] = ctx.match;
    if (!queryId || !source) return;
    await store.togglePublicationSource(
      queryId,
      z.enum(PublicationSourceType).parse(source),
    );
    await ctx.answerCallbackQuery('Updated');
    await ctx.editMessageReplyMarkup();
  });
  bot.command('schedule', async (ctx) => {
    const current = await chat(ctx.chat.id);
    const argument = commandArgument(ctx.message?.text);
    if (!argument)
      return ctx.reply(
        `${current.watcherConfig?.schedule} ${current.watcherConfig?.timezone}`,
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
    const result = await runNow(current.watcherConfig!.id, BigInt(ctx.chat.id));
    if (result.status === 'BUSY')
      await ctx.reply('A run is already in progress.');
    if (result.status === 'FAILED')
      await ctx.reply(
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
