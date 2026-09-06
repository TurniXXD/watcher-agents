import type { BriefingConfigurationStore } from '@watcher/database';
import type { WatcherLogger } from '@watcher/core';
import { describe, expect, it, vi } from 'vitest';
import { createBriefingBot } from '../bot.js';

describe('briefing bot update logging', () => {
  it('keeps the logger receiver when logging Telegram commands', async () => {
    const messages: string[] = [];
    const boundLog = function (this: { active?: boolean }, ...args: unknown[]) {
      if (!this.active) throw new Error('logger receiver was lost');
      messages.push(String(args.at(-1)));
    };
    const logger = {
      active: true,
      debug: boundLog,
      error: boundLog,
      info: boundLog,
      warn: boundLog,
    } as unknown as WatcherLogger;
    const reportError = vi.fn();
    const bot = createBriefingBot(
      'test-token',
      new Set([123]),
      {} as BriefingConfigurationStore,
      reportError,
      undefined,
      undefined,
      undefined,
      undefined,
      logger,
    );
    bot.botInfo = {
      id: 456,
      is_bot: true,
      first_name: 'Briefing Bot',
      username: 'briefing_test_bot',
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
      can_manage_bots: false,
      supports_join_request_queries: false,
    };

    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: 1_788_704_068,
        chat: { id: 123, type: 'private', first_name: 'Operator' },
        from: { id: 123, is_bot: false, first_name: 'Operator' },
        text: '/unknown',
        entities: [{ offset: 0, length: 8, type: 'bot_command' }],
      },
    });

    expect(reportError).not.toHaveBeenCalled();
    expect(messages).toEqual([
      'Briefing bot command received',
      'Briefing bot command completed',
    ]);
  });
});
