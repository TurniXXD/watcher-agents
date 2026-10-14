import { describe, expect, it, vi } from 'vitest';
import { createTransportBot, transportHelp } from '../bot.js';

const update = {
  update_id: 1,
  message: {
    message_id: 1,
    date: 1_788_704_068,
    chat: { id: 123, type: 'private' as const, first_name: 'Operator' },
    from: { id: 123, is_bot: false, first_name: 'Operator' },
    text: '/help',
    entities: [{ offset: 0, length: 5, type: 'bot_command' as const }],
  },
};

describe('transport bot help', () => {
  it('shows help without starting or changing onboarding', async () => {
    const initializeUser = vi.fn();
    const bot = createTransportBot({
      token: 'test-token',
      allowedUserIds: new Set([123]),
      service: { initializeUser },
    } as unknown as Parameters<typeof createTransportBot>[0]);
    bot.botInfo = {
      id: 456,
      is_bot: true,
      first_name: 'Transport Bot',
      username: 'transport_test_bot',
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
    const messages: string[] = [];
    bot.api.config.use(async (_previous, method, payload) => {
      if (method !== 'sendMessage') throw new Error(`Unexpected ${method}`);
      if ('text' in payload && typeof payload.text === 'string')
        messages.push(payload.text);
      return { ok: true, result: { message_id: 1 } } as never;
    });

    await bot.handleUpdate(update);

    expect(messages).toEqual([transportHelp]);
    expect(initializeUser).not.toHaveBeenCalled();
    expect(transportHelp).toContain('🔎 Find jobs');
  });
});
