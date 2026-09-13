import {
  newsCategories,
  newsCategorySchema,
  type ProgressReporter,
  type RunExecution,
} from '@watcher/core';
import {
  newsScopeSchema,
  type NewsConfigurationStore,
  type WatcherStore,
} from '@watcher/database';
import {
  builtInNewsSources,
  builtInNewsSourceUrl,
} from '@watcher/sources/news';
import {
  authorizationMiddleware,
  commandArgument,
  formatRunDuration,
  renderRunProgress,
  splitTelegramMessage,
} from '@watcher/telegram';
import { Bot } from 'grammy';
import { newsAbout, newsHelp } from './copy.js';

const parseScope = (
  value: string | undefined,
): 'CZECH' | 'GLOBAL' | undefined => {
  if (!value) return undefined;
  const parsed = newsScopeSchema.safeParse(value.trim().toUpperCase());
  return parsed.success ? parsed.data : undefined;
};

const scopeName = (scope: 'CZECH' | 'GLOBAL'): string =>
  scope === 'CZECH' ? 'Czech' : 'Global';

export const createNewsBot = (
  token: string,
  allowedIds: ReadonlySet<number>,
  store: WatcherStore,
  newsConfiguration: NewsConfigurationStore,
  runNow: (
    configId: string,
    chatId: bigint,
    options?: {
      onProgress?: ProgressReporter;
      targetKeys?: ReadonlySet<string>;
    },
  ) => Promise<RunExecution>,
  timezone: string,
  reportError: (error: unknown) => void,
): Bot => {
  const bot = new Bot(token);
  bot.use(authorizationMiddleware(allowedIds));
  const chat = async (chatId: number) => {
    const current = await store.ensureChat('NEWS', BigInt(chatId), timezone);
    await newsConfiguration.syncBuiltInFeeds(
      current.id,
      builtInNewsSources.map((source) => ({
        key: source.key,
        scope: source.scope,
        name: source.name,
        url: builtInNewsSourceUrl(source),
      })),
    );
    await newsConfiguration.syncCategoryPreferences(current.id);
    return current;
  };

  bot.command(['start', 'help'], async (context) => {
    await chat(context.chat.id);
    await context.reply(`🗞 News Watcher\n\n${newsHelp}`);
  });
  bot.command('about', async (context) => {
    await chat(context.chat.id);
    await context.reply(newsAbout, {
      parse_mode: 'Markdown',
      link_preview_options: { is_disabled: true },
    });
  });
  bot.command('status', async (context) => {
    const current = await chat(context.chat.id);
    const [feeds, topics, categoryPreferences] = await Promise.all([
      newsConfiguration.listFeeds(current.id),
      newsConfiguration.listTopics(current.id),
      newsConfiguration.listCategoryPreferences(current.id),
    ]);
    const count = (scope: 'CZECH' | 'GLOBAL', enabledOnly = false) =>
      feeds.filter(
        (feed) => feed.scope === scope && (!enabledOnly || feed.enabled),
      ).length;
    await context.reply(
      [
        `Status: ${current.watcherConfig?.enabled ? 'running' : 'paused'}`,
        `Schedule: ${current.watcherConfig?.schedule} (${current.watcherConfig?.timezone})`,
        `Next: ${current.watcherConfig?.nextRunAt?.toISOString() ?? 'not scheduled'}`,
        `Last: ${current.watcherConfig?.lastRunStatus ?? 'never'}`,
        '',
        `Czech: ${count('CZECH', true)}/${count('CZECH')} feeds enabled · ${topics.filter(({ scope }) => scope === 'CZECH').length} topics`,
        `Global: ${count('GLOBAL', true)}/${count('GLOBAL')} feeds enabled · ${topics.filter(({ scope }) => scope === 'GLOBAL').length} topics`,
        `Sport: Czech ${categoryPreferences.some(({ scope, category, enabled }) => scope === 'CZECH' && category === 'SPORT' && enabled) ? 'enabled' : 'disabled'} · Global ${categoryPreferences.some(({ scope, category, enabled }) => scope === 'GLOBAL' && category === 'SPORT' && enabled) ? 'enabled' : 'disabled'}`,
      ].join('\n'),
    );
  });
  bot.command('feeds', async (context) => {
    const current = await chat(context.chat.id);
    const feeds = await newsConfiguration.listFeeds(current.id);
    const message = feeds.length
      ? [
          'News sources (built-in sources are configured automatically):',
          '',
          ...feeds.map(
            (feed) =>
              `${feed.enabled ? '✅' : '⏸'} ${scopeName(feed.scope)} · ${feed.name}${feed.builtInKey ? ' · built-in' : ' · custom'}\nID: ${feed.id}\n${feed.url}`,
          ),
        ].join('\n\n')
      : 'No news sources are available.';
    for (const part of splitTelegramMessage(message)) {
      await context.reply(part, {
        link_preview_options: { is_disabled: true },
      });
    }
  });
  bot.command('feed_add', async (context) => {
    const parts = (commandArgument(context.message?.text) ?? '')
      .split(/\s+/u)
      .filter(Boolean);
    const scope = parseScope(parts.shift());
    const url = parts.shift();
    if (!scope || !url) {
      await context.reply('Usage: /feed_add czech|global URL [NAME]');
      return;
    }
    let defaultName: string;
    try {
      defaultName = new URL(url).hostname;
    } catch {
      await context.reply('Feed URL is invalid. Use a public HTTP(S) URL.');
      return;
    }
    const current = await chat(context.chat.id);
    const feed = await newsConfiguration.addFeed(
      current.id,
      scope,
      url,
      parts.join(' ') || defaultName,
    );
    await context.reply(
      `${scopeName(feed.scope)} feed “${feed.name}” configured.\nID: ${feed.id}`,
    );
  });
  bot.command('feed_remove', async (context) => {
    const id = commandArgument(context.message?.text);
    if (!id) {
      await context.reply('Usage: /feed_remove ID');
      return;
    }
    const current = await chat(context.chat.id);
    const result = await newsConfiguration.removeFeed(current.id, id);
    await context.reply(
      result === 'REMOVED'
        ? 'Feed removed.'
        : result === 'BUILT_IN'
          ? 'Built-in sources cannot be removed. Use /feed_disable ID instead.'
          : 'Feed was not found.',
    );
  });
  bot.command(['feed_enable', 'feed_disable'], async (context) => {
    const id = commandArgument(context.message?.text);
    if (!id) {
      await context.reply('Usage: /feed_enable ID or /feed_disable ID');
      return;
    }
    const current = await chat(context.chat.id);
    const enabled = context.message?.text?.startsWith('/feed_enable') === true;
    const updated = await newsConfiguration.setFeedEnabled(
      current.id,
      id,
      enabled,
    );
    await context.reply(
      updated
        ? `Feed ${enabled ? 'enabled' : 'disabled'}.`
        : 'Feed was not found.',
    );
  });
  bot.command('topics', async (context) => {
    const current = await chat(context.chat.id);
    const topics = await newsConfiguration.listTopics(current.id);
    const forScope = (scope: 'CZECH' | 'GLOBAL') =>
      topics
        .filter((topic) => topic.scope === scope)
        .map(({ topic }) => `• ${topic}`);
    await context.reply(
      [
        'Ranking topics:',
        '',
        '🇨🇿 Czech',
        ...(forScope('CZECH').length ? forScope('CZECH') : ['• none']),
        '',
        '🌍 Global',
        ...(forScope('GLOBAL').length ? forScope('GLOBAL') : ['• none']),
      ].join('\n'),
    );
  });
  bot.command(['topic_add', 'topic_remove'], async (context) => {
    const parts = (commandArgument(context.message?.text) ?? '').split(/\s+/u);
    const scope = parseScope(parts.shift());
    const topic = parts.join(' ').trim();
    if (!scope || !topic) {
      await context.reply(
        'Usage: /topic_add czech|global TOPIC or /topic_remove czech|global TOPIC',
      );
      return;
    }
    const current = await chat(context.chat.id);
    if (context.message?.text?.startsWith('/topic_add')) {
      await newsConfiguration.addTopic(current.id, scope, topic);
      await context.reply(`${scopeName(scope)} topic “${topic}” configured.`);
    } else {
      const removed = await newsConfiguration.removeTopic(
        current.id,
        scope,
        topic,
      );
      await context.reply(removed ? 'Topic removed.' : 'Topic was not found.');
    }
  });
  bot.command('categories', async (context) => {
    const current = await chat(context.chat.id);
    const preferences = await newsConfiguration.listCategoryPreferences(
      current.id,
    );
    const forScope = (scope: 'CZECH' | 'GLOBAL') =>
      newsCategories.map((category) => {
        const enabled =
          preferences.find(
            (preference) =>
              preference.scope === scope && preference.category === category,
          )?.enabled ?? true;
        return `${enabled ? '✅' : '⏸'} ${category}`;
      });
    await context.reply(
      [
        'News categories:',
        '',
        '🇨🇿 Czech',
        ...forScope('CZECH'),
        '',
        '🌍 Global',
        ...forScope('GLOBAL'),
      ].join('\n'),
    );
  });
  bot.command(['category_enable', 'category_disable'], async (context) => {
    const parts = (commandArgument(context.message?.text) ?? '')
      .split(/\s+/u)
      .filter(Boolean);
    const scope = parseScope(parts[0]);
    const category = newsCategorySchema.safeParse(parts[1]?.toUpperCase());
    if (!scope || !category.success || parts.length !== 2) {
      await context.reply(
        'Usage: /category_enable czech|global CATEGORY or /category_disable czech|global CATEGORY',
      );
      return;
    }
    const current = await chat(context.chat.id);
    const enabled =
      context.message?.text?.startsWith('/category_enable') === true;
    await newsConfiguration.setCategoryEnabled(
      current.id,
      scope,
      category.data,
      enabled,
    );
    await context.reply(
      `${scopeName(scope)} ${category.data} category ${enabled ? 'enabled' : 'disabled'}.`,
    );
  });
  bot.command('schedule', async (context) => {
    const current = await chat(context.chat.id);
    const argument = commandArgument(context.message?.text);
    if (!argument) {
      await context.reply(
        `Current schedule: ${current.watcherConfig?.schedule} ${current.watcherConfig?.timezone}\nExample: /schedule 0 7 * * * Europe/Prague`,
      );
      return;
    }
    const parts = argument.split(/\s+/u);
    const selectedTimezone = parts.at(-1)?.includes('/')
      ? parts.pop()
      : current.watcherConfig?.timezone;
    await store.updateSchedule(
      current.watcherConfig!.id,
      parts.join(' '),
      selectedTimezone ?? timezone,
    );
    await context.reply('Schedule updated.');
  });
  bot.command('run', async (context) => {
    const current = await chat(context.chat.id);
    const argument = commandArgument(context.message?.text);
    const scope = parseScope(argument);
    if (argument && !scope) {
      await context.reply('Usage: /run [czech|global]');
      return;
    }
    const initialProgress = renderRunProgress({ percent: 0, step: 'Starting' });
    const progressMessage = await context.reply(initialProgress);
    let lastProgress = initialProgress;
    const onProgress: ProgressReporter = async (progress) => {
      const text = renderRunProgress(progress);
      if (text === lastProgress) return;
      lastProgress = text;
      await context.api.editMessageText(
        context.chat.id,
        progressMessage.message_id,
        text,
      );
    };
    const result = await runNow(
      current.watcherConfig!.id,
      BigInt(context.chat.id),
      {
        onProgress,
        ...(scope ? { targetKeys: new Set([scope]) } : {}),
      },
    );
    if (result.status === 'BUSY') {
      await context.api.editMessageText(
        context.chat.id,
        progressMessage.message_id,
        'A run is already in progress.',
      );
    } else if (result.status === 'FAILED') {
      await context.api.editMessageText(
        context.chat.id,
        progressMessage.message_id,
        `Run failed after ${formatRunDuration(result.durationMs)}: ${result.error}`,
      );
    }
  });
  bot.command('pause', async (context) => {
    const current = await chat(context.chat.id);
    await store.setEnabled(current.watcherConfig!.id, false);
    await context.reply('Scheduled runs paused.');
  });
  bot.command('resume', async (context) => {
    const current = await chat(context.chat.id);
    await store.setEnabled(current.watcherConfig!.id, true);
    await context.reply('Scheduled runs resumed.');
  });
  bot.catch((error) => reportError(error.error));
  return bot;
};
