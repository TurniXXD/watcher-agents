import { describe, expect, it, vi } from 'vitest';
import { createStudyBot } from '../bot.js';

const commandUpdate = (text: string, updateId: number) => ({
  update_id: updateId,
  message: {
    message_id: updateId,
    date: 1_793_318_400,
    chat: { id: 123, type: 'private' as const, first_name: 'Operator' },
    from: { id: 123, is_bot: false, first_name: 'Operator' },
    text,
    entities: [
      {
        offset: 0,
        length: text.includes(' ') ? text.indexOf(' ') : text.length,
        type: 'bot_command' as const,
      },
    ],
  },
});

const callbackUpdate = (data: string, updateId: number) => ({
  update_id: updateId,
  callback_query: {
    id: `callback-${updateId}`,
    from: { id: 123, is_bot: false, first_name: 'Operator' },
    chat_instance: 'study-test',
    data,
    message: {
      message_id: updateId,
      date: 1_793_318_400,
      chat: { id: 123, type: 'private' as const, first_name: 'Operator' },
      text: 'Confirm book',
    },
  },
});

const draft = {
  title: 'Dune',
  author: 'Frank Herbert',
  categories: ['Sci-fi'],
  genre: 'Beletrie',
  pages: 544,
  complexity: 'Neurčeno',
  note: 'Metadata: Open Library.',
  sourceUrl: 'https://openlibrary.org/works/OL893415W',
  priority: false,
  read: false,
  nextToRead: false,
  favorite: false,
};

const createHarness = () => {
  const books = {
    prepare: vi.fn().mockResolvedValue({ id: 'draft-id', draft }),
    confirm: vi.fn().mockResolvedValue({
      created: true,
      title: 'Dune',
      url: 'https://www.notion.so/dune',
    }),
    cancel: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    categories: vi.fn().mockResolvedValue(['Sci-fi']),
    authors: vi.fn().mockResolvedValue(['Frank Herbert']),
  };
  const bot = createStudyBot({
    token: 'test-token',
    allowedIds: new Set([123]),
    books,
    reportError: vi.fn(),
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
  const callbacks: string[] = [];
  bot.api.config.use(async (_previous, method, payload) => {
    if (method === 'sendMessage') {
      if ('text' in payload && typeof payload.text === 'string') {
        messages.push(payload.text);
      }
      return { ok: true, result: { message_id: messages.length } } as never;
    }
    if (method === 'answerCallbackQuery') {
      if ('text' in payload && typeof payload.text === 'string') {
        callbacks.push(payload.text);
      }
      return { ok: true, result: true } as never;
    }
    throw new Error(`Unexpected ${method}`);
  });
  return { books, bot, callbacks, messages };
};

describe('study bot book commands', () => {
  it('previews metadata and saves only after owner confirmation', async () => {
    const harness = createHarness();

    await harness.bot.handleUpdate(commandUpdate('/book_add Dune', 1));

    expect(harness.books.prepare).toHaveBeenCalledWith({
      chatId: 123n,
      userId: 123n,
      title: 'Dune',
    });
    expect(harness.books.confirm).not.toHaveBeenCalled();
    expect(harness.messages.join('\n')).toContain('Confirm book');
    expect(harness.messages.join('\n')).toContain(
      'Nothing is saved until you confirm.',
    );

    await harness.bot.handleUpdate(
      callbackUpdate('study:book:confirm:draft-id', 2),
    );

    expect(harness.books.confirm).toHaveBeenCalledWith({
      id: 'draft-id',
      chatId: 123n,
      userId: 123n,
    });
    expect(harness.callbacks).toEqual(['Saving to Notion…']);
    expect(harness.messages.join('\n')).toContain('✅ Saved: Dune');
  });

  it('routes list filters and taxonomy commands without network access', async () => {
    const harness = createHarness();

    await harness.bot.handleUpdate(commandUpdate('/books_category Sci-fi', 3));
    await harness.bot.handleUpdate(
      commandUpdate('/books_author Frank Herbert', 4),
    );
    await harness.bot.handleUpdate(commandUpdate('/books_next', 5));
    await harness.bot.handleUpdate(commandUpdate('/books_favorites', 6));
    await harness.bot.handleUpdate(commandUpdate('/books_categories', 7));
    await harness.bot.handleUpdate(commandUpdate('/books_authors', 8));

    expect(harness.books.list).toHaveBeenNthCalledWith(1, {
      type: 'category',
      value: 'Sci-fi',
    });
    expect(harness.books.list).toHaveBeenNthCalledWith(2, {
      type: 'author',
      value: 'Frank Herbert',
    });
    expect(harness.books.list).toHaveBeenNthCalledWith(3, { type: 'next' });
    expect(harness.books.list).toHaveBeenNthCalledWith(4, {
      type: 'favorites',
    });
    expect(harness.messages.join('\n')).toContain('Sci-fi');
    expect(harness.messages.join('\n')).toContain('Frank Herbert');
  });

  it('rejects unsupported category values at the Telegram boundary', async () => {
    const harness = createHarness();

    await harness.bot.handleUpdate(
      commandUpdate('/books_category Unsupported', 9),
    );

    expect(harness.books.list).not.toHaveBeenCalled();
    expect(harness.messages).toEqual([
      'Usage: /books_category CATEGORY — use /books_categories for valid values.',
    ]);
  });
});
