import { describe, expect, it } from 'vitest';
import { createStudyBot, studyAbout, studyHelp } from '../bot.js';

const update = (text: '/help' | '/about', updateId: number) => ({
  update_id: updateId,
  message: {
    message_id: updateId,
    date: 1_792_102_400,
    chat: { id: 123, type: 'private' as const, first_name: 'Operator' },
    from: { id: 123, is_bot: false, first_name: 'Operator' },
    text,
    entities: [
      { offset: 0, length: text.length, type: 'bot_command' as const },
    ],
  },
});

describe('study bot informational commands', () => {
  it('serves help and about without accessing study state', async () => {
    const bot = createStudyBot({
      token: 'test-token',
      allowedIds: new Set([123]),
      reportError: () => undefined,
    } as never);
    bot.botInfo = {
      id: 456,
      is_bot: true,
      first_name: 'Study Bot',
      username: 'study_test_bot',
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

    await bot.handleUpdate(update('/help', 1));
    await bot.handleUpdate(update('/about', 2));

    expect(messages).toEqual([studyHelp, studyAbout]);
    expect(studyAbout).toContain('source-page references');
    expect(studyAbout).toContain('does not browse for replacement facts');
  });
});
