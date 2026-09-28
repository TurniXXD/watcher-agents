import type {
  BriefingConfigurationStore,
  BriefingGoalStore,
} from '@watcher/database';
import { describe, expect, it, vi } from 'vitest';
import { createBriefingBot } from '../bot.js';

const makeBot = () => {
  const store = {
    ensure: vi.fn(async () => ({
      settings: { timezone: 'Europe/Prague' },
    })),
  } as unknown as BriefingConfigurationStore;
  const add = vi.fn(async () => ({
    id: 7,
    title: 'Finish my degree',
    dueOn: '2027-06-30',
  }));
  const list = vi.fn(async () => [
    { id: 7, title: 'Finish my degree', dueOn: '2027-06-30' },
  ]);
  const remove = vi.fn(async () => true);
  const goals = { add, list, remove } as unknown as BriefingGoalStore;
  const bot = createBriefingBot(
    'test-token',
    new Set([123]),
    store,
    vi.fn(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    goals,
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
  const send = vi.fn();
  bot.api.config.use(async (_previous, method, payload) => {
    if (method !== 'sendMessage') throw new Error(`Unexpected ${method}`);
    send(payload);
    return { ok: true, result: { message_id: 1 } } as never;
  });
  return { bot, add, list, remove, send };
};

const update = (
  text: string,
  chatId = 123,
  chatType: 'private' | 'group' = 'private',
) => ({
  update_id: Math.abs(chatId) + text.length,
  message: {
    message_id: 1,
    date: 1_788_704_068,
    chat:
      chatType === 'private'
        ? { id: chatId, type: 'private' as const, first_name: 'Operator' }
        : { id: chatId, type: 'group' as const, title: 'Shared room' },
    from: { id: 123, is_bot: false, first_name: 'Operator' },
    text,
    entities: [
      {
        offset: 0,
        length: text.split(' ', 1)[0]!.length,
        type: 'bot_command' as const,
      },
    ],
  },
});

describe('briefing goal commands', () => {
  it('adds, lists and removes goals only for the private chat', async () => {
    const { bot, add, list, remove, send } = makeBot();

    await bot.handleUpdate(update('/goal_add 2027-06-30 Finish my degree'));
    await bot.handleUpdate(update('/goals'));
    await bot.handleUpdate(update('/goal_remove 7'));

    expect(add).toHaveBeenCalledWith(123n, {
      dueOn: '2027-06-30',
      title: 'Finish my degree',
    });
    expect(list).toHaveBeenCalledWith(123n);
    expect(remove).toHaveBeenCalledWith(123n, 7);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('rejects invalid dates and refuses goal commands in group chats', async () => {
    const { bot, add, list, send } = makeBot();

    await bot.handleUpdate(update('/goal_add 2026-02-30 Impossible date'));
    await bot.handleUpdate(update('/goals', -100, 'group'));

    expect(add).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(2);
  });
});
