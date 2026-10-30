import { describe, expect, it } from 'vitest';
import {
  createStudyBot,
  studyAbout,
  studyCommands,
  studyHelp,
} from '../bot.js';

const update = (text: string, updateId: number, userId = 123) => ({
  update_id: updateId,
  message: {
    message_id: updateId,
    date: 1_792_102_400,
    chat: { id: userId, type: 'private' as const, first_name: 'Operator' },
    from: { id: userId, is_bot: false, first_name: 'Operator' },
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
    expect(studyAbout).toContain('does not browse for replacement PDF facts');
  });

  it('rejects unauthorized informational and book commands', async () => {
    const bot = createStudyBot({
      token: 'test-token',
      allowedIds: new Set([123]),
      books: { prepare: () => Promise.reject(new Error('must not run')) },
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

    await bot.handleUpdate(update('/about', 3, 999));
    await bot.handleUpdate(update('/book_add Dune', 4, 999));

    expect(messages).toEqual(['Unauthorized.', 'Unauthorized.']);
  });

  it('keeps command registry, handlers, help copy, and Telegram limits aligned', () => {
    for (const command of studyCommands) {
      expect(studyHelp).toContain(`/${command.command}`);
      expect(command.command.length).toBeLessThanOrEqual(32);
      expect(command.description.length).toBeLessThanOrEqual(256);
    }
    expect(studyHelp.length).toBeLessThanOrEqual(4_096);
    expect(studyAbout.length).toBeLessThanOrEqual(4_096);
  });
});
