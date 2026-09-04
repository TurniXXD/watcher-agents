import type { RunExecution } from '@watcher/core';
import { PublicationSourceType, type WatcherStore } from '@watcher/database';
import {
  authorizationMiddleware,
  commandArgument,
  formatRunDuration,
  parsePublicationQueriesCsv,
  publicationQuerySchema,
  renderRunProgress,
} from '@watcher/telegram';
import { Bot, InlineKeyboard, type Context } from 'grammy';
import type { Document } from 'grammy/types';
import { z } from 'zod';
import type { ProgressReporter } from '@watcher/core';

const scheduleExample = '/schedule 0 8 * * * Europe/Prague';
const maxCsvBytes = 256 * 1024;

const help = `/help — show this command list
/status — watcher status
/queries — list topics
/addquery TOPIC — add a topic (all sources enabled by default)
/addqueries — reply to an attached CSV file to add multiple topics
/removequery TOPIC — remove a topic
/sources — configure sources with buttons
/schedule [CRON] [TIMEZONE] — view or update schedule
  Example: ${scheduleExample}
/run — run now
/pause — pause scheduled runs
/resume — resume scheduled runs`;

const addQueriesCommandPattern = /^\/addqueries(?:@\w+)?(?:\s|$)/;

const isCsvDocument = (document: Document): boolean => {
  const fileName = document.file_name?.toLowerCase();
  const mimeType = document.mime_type?.toLowerCase();
  return (
    fileName?.endsWith('.csv') === true ||
    ['text/csv', 'text/plain', 'application/vnd.ms-excel'].includes(
      mimeType ?? '',
    )
  );
};

const getCsvDocument = (ctx: Context): Document | undefined =>
  ctx.message?.document ?? ctx.message?.reply_to_message?.document;

const downloadTelegramTextFile = async (
  ctx: Context,
  token: string,
  document: Document,
): Promise<string> => {
  if (document.file_size && document.file_size > maxCsvBytes)
    throw new Error('CSV file is too large. Maximum size is 256 KiB.');

  const file = await ctx.api.getFile(document.file_id);
  if (file.file_size && file.file_size > maxCsvBytes)
    throw new Error('CSV file is too large. Maximum size is 256 KiB.');
  if (!file.file_path)
    throw new Error('Telegram did not return a downloadable file path.');

  const response = await fetch(
    `https://api.telegram.org/file/bot${token}/${file.file_path}`,
  );
  if (!response.ok)
    throw new Error(`Telegram file download failed: HTTP ${response.status}`);

  const body = await response.arrayBuffer();
  if (body.byteLength > maxCsvBytes)
    throw new Error('CSV file is too large. Maximum size is 256 KiB.');

  return new TextDecoder().decode(body).replace(/^\uFEFF/, '');
};

export const createPublicationsBot = (
  token: string,
  allowedIds: ReadonlySet<number>,
  store: WatcherStore,
  runNow: (
    configId: string,
    chatId: bigint,
    options?: { onProgress?: ProgressReporter },
  ) => Promise<RunExecution>,
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
    await ctx.reply(`“${query}” added. All publication sources are enabled.`);
  });
  const addQueriesFromCsv = async (ctx: Context): Promise<void> => {
    if (!ctx.chat) return;
    const document = getCsvDocument(ctx);
    if (!document) {
      await ctx.reply(
        'Attach a CSV file and use /addqueries as the caption, or reply to a CSV file with /addqueries. The CSV can have a query or topic header, otherwise the first column is used.',
      );
      return;
    }
    if (!isCsvDocument(document)) {
      await ctx.reply('Please attach a .csv file.');
      return;
    }

    const current = await chat(ctx.chat.id);
    const csv = await downloadTelegramTextFile(ctx, token, document);
    const queries = parsePublicationQueriesCsv(csv);
    if (!queries.length) {
      await ctx.reply('No publication queries were found in the CSV file.');
      return;
    }

    const result = await store.addQueries(current.id, queries);
    await ctx.reply(
      `Imported ${result.addedCount} ${result.addedCount === 1 ? 'query' : 'queries'} from CSV. ${result.skippedCount} ${result.skippedCount === 1 ? 'duplicate was' : 'duplicates were'} skipped. All publication sources are enabled for new queries.`,
    );
  };
  bot.command('addqueries', addQueriesFromCsv);
  bot.on('message:document', async (ctx, next) => {
    if (addQueriesCommandPattern.test(ctx.message.caption ?? '')) {
      await addQueriesFromCsv(ctx);
      return;
    }
    await next();
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
