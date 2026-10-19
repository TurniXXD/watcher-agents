import { describe, expect, it } from 'vitest';
import {
  createNetworkingBot,
  networkingAbout,
  networkingBotCommands,
  networkingHelp,
} from '../bot.js';

const update = {
  update_id: 1,
  message: {
    message_id: 1,
    date: 1_792_102_400,
    chat: { id: 123, type: 'private' as const, first_name: 'Operator' },
    from: { id: 123, is_bot: false, first_name: 'Operator' },
    text: '/help',
    entities: [{ offset: 0, length: 5, type: 'bot_command' as const }],
  },
};

describe('networking bot help', () => {
  it('serves its own help and keeps unauthorized users out', async () => {
    const bot = createNetworkingBot({
      token: 'test-token',
      allowedIds: new Set([123]),
      reportError: () => undefined,
    } as never);
    bot.botInfo = {
      id: 456,
      is_bot: true,
      first_name: 'Networking Bot',
      username: 'networking_test_bot',
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
      if ('text' in payload && typeof payload.text === 'string') {
        messages.push(payload.text);
      }
      return { ok: true, result: { message_id: 1 } } as never;
    });

    await bot.handleUpdate(update);
    await bot.handleUpdate({
      ...update,
      update_id: 2,
      message: {
        ...update.message,
        message_id: 2,
        text: '/about',
        entities: [{ offset: 0, length: 6, type: 'bot_command' as const }],
      },
    });
    await bot.handleUpdate({
      ...update,
      update_id: 3,
      message: {
        ...update.message,
        message_id: 3,
        from: { ...update.message.from, id: 999 },
      },
    });

    expect(messages).toEqual([
      networkingHelp,
      networkingAbout,
      'Unauthorized.',
    ]);
    expect(networkingHelp).toContain('/network_events');
    expect(networkingHelp).toContain('/network_add');
    expect(networkingBotCommands).toContainEqual(
      expect.objectContaining({ command: 'about' }),
    );
    expect(networkingAbout).toContain('automaticky nekontaktuje');
  });
});
