import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { WatcherLogger } from '@watcher/core';
import type { MaintenanceStore } from '@watcher/database';
import { authorizationMiddleware, isAuthorized } from '@watcher/telegram';
import { Bot } from 'grammy';
import type { MaintenanceEngine } from './evaluation/engine.js';
import type { Finding } from './evaluation/types.js';
import {
  renderSystemSnapshot,
  type SystemMetricsSampler,
} from './runtime-monitor.js';

const severityEmoji: Record<string, string> = {
  CRITICAL: '🚨',
  HIGH: '🔴',
  MEDIUM: '🟠',
  LOW: '🟡',
  INFO: '🔵',
};

export const renderReport = (title: string, findings: Finding[]): string => {
  const important = findings
    .filter((finding) =>
      ['CRITICAL', 'HIGH', 'MEDIUM'].includes(finding.severity),
    )
    .slice(0, 15);
  if (important.length === 0)
    return `🛠 ${title}\n\nNo important maintenance findings.`;
  return [
    `🛠 ${title}`,
    '',
    ...important.flatMap((finding) => [
      `${severityEmoji[finding.severity]} ${finding.agentName}: ${finding.title}`,
      `Recommendation: ${finding.recommendation.title}`,
      `Confidence: ${Math.round(finding.confidence * 100)}%`,
      '',
    ]),
    'No production changes were applied. Every recommendation requires human approval.',
  ].join('\n');
};

const changelogEntries = (markdown: string) =>
  markdown
    .split(/^##\s+/mu)
    .slice(1)
    .map((entry) => {
      const [title = '', ...body] = entry.trim().split('\n');
      const text = body.join('\n').trim();
      return {
        title: title.trim(),
        body: text,
        hash: createHash('sha256').update(`${title}\n${text}`).digest('hex'),
      };
    })
    .filter((entry) => entry.title && entry.body);

export const createMaintenanceBot = (
  token: string,
  allowedIds: ReadonlySet<number>,
  engine: MaintenanceEngine,
  store: MaintenanceStore,
  logger: WatcherLogger,
  changelogPath: string,
  systemMetrics: SystemMetricsSampler,
) => {
  const bot = new Bot(token);
  const authorize = authorizationMiddleware(allowedIds);
  bot.use(async (context, next) => {
    if (!isAuthorized(allowedIds, context.from?.id)) {
      logger.warn(
        {
          telegramUserId: context.from?.id,
          telegramChatId: context.chat?.id,
          allowedUserCount: allowedIds.size,
        },
        'Unauthorized Maintenance Telegram update rejected',
      );
    }
    await authorize(context, next);
  });
  const summary = async () => {
    const findings = await store.listFindings({ status: 'OPEN', limit: 100 });
    const lines = findings
      .slice(0, 15)
      .map(
        (finding) =>
          `${severityEmoji[finding.severity]} ${finding.agentName}: ${finding.title}`,
      );
    return [
      '🛠 Maintenance summary',
      '',
      ...(lines.length ? lines : ['No open findings.']),
    ].join('\n');
  };
  bot.command('start', async (context) =>
    context.reply(
      'Maintenance Agent monitors agent health, server capacity, and only proposes changes.\n\n/help — commands\n/summary — open findings\n/run — evaluate the last 7 days\n/debug — enable detailed bot run reports\n/recommendations — proposed changes',
    ),
  );
  bot.command('help', async (context) =>
    context.reply(
      '/summary — current findings\n/run — run maintenance evaluation\n/debug [on|off|status] — detailed reports for completed bot runs\n/recommendations — top proposals\n/updates — recent project changes\n\nCapacity warnings are always active. The bot cannot deploy or apply a recommendation.',
    ),
  );
  bot.command('summary', async (context) => context.reply(await summary()));
  bot.command('run', async (context) => {
    await context.reply('⏳ Running maintenance evaluation…');
    const result = await engine.run('MANUAL', 24 * 7);
    await context.reply(
      renderReport('Manual maintenance report', result.findings),
    );
  });
  bot.command('recommendations', async (context) => {
    const recommendations = await store.listRecommendations({
      status: 'PROPOSED',
      limit: 15,
    });
    await context.reply(
      [
        '🧰 Proposed maintenance changes',
        '',
        ...(recommendations.length
          ? recommendations.map(
              (item) =>
                `• ${item.agentName}: ${item.title} (${Math.round(item.confidence * 100)}%)`,
            )
          : ['No proposals.']),
        '',
        'Approve or reject proposals through the authenticated API. Approval never applies a change automatically.',
      ].join('\n'),
    );
  });
  bot.command('updates', async (context) => {
    try {
      const entries = changelogEntries(await readFile(changelogPath, 'utf8'))
        .slice(-3)
        .reverse();
      await context.reply(
        [
          '🆕 Recent project updates',
          '',
          ...entries.flatMap((entry) => [entry.title, entry.body, '']),
        ].join('\n'),
      );
    } catch (error) {
      logger.warn(
        { err: error, changelogPath },
        'Maintenance changelog command failed',
      );
      await context.reply('Project changelog is unavailable.');
    }
  });
  bot.command('debug', async (context) => {
    if (!context.chat) return;
    const chatId = BigInt(context.chat.id);
    const argument = context.match.trim().toLowerCase();
    if (!argument || argument === 'on') {
      await store.setDebugEnabled(chatId, true);
      const snapshot = await systemMetrics.sample();
      await context.reply(
        [
          '🔬 Debug run reporting enabled.',
          'I will report newly completed runs from other bots. Use /debug off to stop.',
          '',
          renderSystemSnapshot(snapshot),
        ].join('\n'),
      );
      return;
    }
    if (argument === 'off') {
      await store.setDebugEnabled(chatId, false);
      await context.reply('🔕 Debug run reporting disabled.');
      return;
    }
    if (argument === 'status') {
      const [subscription, snapshot] = await Promise.all([
        store.debugSubscription(chatId),
        systemMetrics.sample(),
      ]);
      await context.reply(
        [
          `🔬 Debug run reporting: ${subscription?.enabled ? 'enabled' : 'disabled'}`,
          subscription?.enabledAt
            ? `Since: ${subscription.enabledAt.toISOString()}`
            : 'No active reporting window.',
          '',
          renderSystemSnapshot(snapshot),
        ].join('\n'),
      );
      return;
    }
    await context.reply('Usage: /debug [on|off|status]');
  });
  bot.catch((error) =>
    logger.error({ err: error.error }, 'Maintenance Telegram update failed'),
  );
  return { bot, summary };
};

export const announceChangelog = async (
  bot: Bot,
  store: MaintenanceStore,
  allowedIds: ReadonlySet<number>,
  path: string,
  logger: WatcherLogger,
): Promise<void> => {
  let markdown: string;
  try {
    markdown = await readFile(path, 'utf8');
  } catch (error) {
    logger.warn(
      { err: error, path },
      'Maintenance changelog could not be read',
    );
    return;
  }
  for (const entry of changelogEntries(markdown)) {
    for (const chatId of allowedIds) {
      if (
        !(await store.claimChangeAnnouncement(
          entry.hash,
          BigInt(chatId),
          entry.title,
        ))
      )
        continue;
      try {
        await bot.api.sendMessage(
          chatId,
          `🆕 Project update: ${entry.title}\n\n${entry.body}`,
        );
      } catch (error) {
        await store.releaseChangeAnnouncement(entry.hash, BigInt(chatId));
        logger.warn(
          { err: error, chatId, title: entry.title },
          'Maintenance changelog announcement failed',
        );
      }
    }
  }
};
