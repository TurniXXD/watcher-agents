import type { BriefingConfigurationStore } from '@watcher/database';
import { describe, expect, it, vi } from 'vitest';
import { createBriefingBot } from '../bot.js';
import { briefingAbout, briefingHelp } from '../onboarding.js';

const update = (text: string, userId = 123) => ({
  update_id: userId + text.length,
  message: {
    message_id: 1,
    date: 1_793_358_000,
    chat: { id: userId, type: 'private' as const, first_name: 'Operator' },
    from: { id: userId, is_bot: false, first_name: 'Operator' },
    text,
    entities: [
      {
        offset: 0,
        length: text.length,
        type: 'bot_command' as const,
      },
    ],
  },
});

describe('Briefing Bot informational commands', () => {
  it('serves exact side-effect-free help and about responses to the operator', async () => {
    const ensure = vi.fn();
    const bot = createBriefingBot(
      'test-token',
      new Set([123]),
      { ensure } as unknown as BriefingConfigurationStore,
      vi.fn(),
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
    const sent: string[] = [];
    bot.api.config.use(async (_previous, method, payload) => {
      if (method !== 'sendMessage') throw new Error(`Unexpected ${method}`);
      sent.push(String((payload as { text?: unknown }).text));
      return { ok: true, result: { message_id: sent.length } } as never;
    });

    await bot.handleUpdate(update('/help'));
    await bot.handleUpdate(update('/about'));

    expect(sent).toEqual([briefingHelp, briefingAbout]);
    expect(ensure).not.toHaveBeenCalled();
  });

  it('blocks informational commands from unauthorized users', async () => {
    const bot = createBriefingBot(
      'test-token',
      new Set([123]),
      {} as BriefingConfigurationStore,
      vi.fn(),
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
    const sent: string[] = [];
    bot.api.config.use(async (_previous, method, payload) => {
      if (method !== 'sendMessage') throw new Error(`Unexpected ${method}`);
      sent.push(String((payload as { text?: unknown }).text));
      return { ok: true, result: { message_id: sent.length } } as never;
    });

    await bot.handleUpdate(update('/help', 999));

    expect(sent).toEqual(['Unauthorized.']);
  });
});
