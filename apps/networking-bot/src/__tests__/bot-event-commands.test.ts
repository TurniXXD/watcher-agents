import { describe, expect, it, vi } from 'vitest';
import { createNetworkingBot } from '../bot.js';

const commandUpdate = (text: string, updateId: number) => ({
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

describe('networking event commands', () => {
  it('requests today and this-week free-food scopes through the shared service', async () => {
    const discoverEvents = vi.fn().mockResolvedValue([]);
    const bot = createNetworkingBot({
      token: 'test-token',
      allowedIds: new Set([123]),
      service: { discoverEvents },
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
      if ('text' in payload && typeof payload.text === 'string')
        messages.push(payload.text);
      return { ok: true, result: { message_id: 1 } } as never;
    });

    await bot.handleUpdate(commandUpdate('/networking_today', 1));
    await bot.handleUpdate(commandUpdate('/networking_free_food', 2));

    expect(discoverEvents).toHaveBeenNthCalledWith(1, 123n, 123n, {
      range: 'TODAY',
    });
    expect(discoverEvents).toHaveBeenNthCalledWith(2, 123n, 123n, {
      range: 'THIS_WEEK',
      freeFoodOnly: true,
    });
    expect(messages).toEqual([
      'Dnes už nejsou žádné odpovídající prezenční akce.',
      'Do konce tohoto týdne nejsou žádné akce s doloženým jídlem nebo občerstvením zdarma.',
    ]);
  });

  it('renders Calendar and registration buttons and writes only the owned event from the callback', async () => {
    const eventId = '11111111-1111-4111-8111-111111111111';
    const listedEvent = {
      id: eventId,
      title: 'Validation Camp',
      description: 'Workshop',
      startAt: new Date('2026-10-21T15:00:00Z'),
      endAt: new Date('2026-10-21T17:00:00Z'),
      timezone: 'Europe/Prague',
      venue: 'Impact Hub',
      city: 'Brno',
      priceStatus: 'FREE',
      accessType: 'REGISTRATION_REQUIRED',
      registrationUrl: 'https://example.com/register',
      canonicalUrl: 'https://example.com/event',
      sourceProvider: 'csob-validation-camps',
      sourceReferences: [{ provider: 'ČSOB' }],
    };
    const discoverEvents = vi.fn().mockResolvedValue([listedEvent]);
    const addEventToCalendar = vi.fn().mockResolvedValue({
      event: listedEvent,
      calendarEvent: {
        id: 'google-event',
        htmlLink: 'https://calendar.google.com/event?eid=test',
        duplicate: false,
      },
    });
    const bot = createNetworkingBot({
      token: 'test-token',
      allowedIds: new Set([123]),
      service: { discoverEvents, addEventToCalendar },
      calendar: {
        status: vi.fn().mockResolvedValue({ connected: true }),
        authorizationUrl: vi.fn(),
      },
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
    const sentPayloads: unknown[] = [];
    bot.api.config.use(async (_previous, method, payload) => {
      if (method === 'sendMessage') {
        sentPayloads.push(payload);
        return { ok: true, result: { message_id: 1 } } as never;
      }
      if (method === 'answerCallbackQuery') {
        return { ok: true, result: true } as never;
      }
      throw new Error(`Unexpected ${method}`);
    });

    await bot.handleUpdate(commandUpdate('/network_events', 10));
    expect(JSON.stringify(sentPayloads[0])).toContain(
      `networking:calendar:${eventId}`,
    );
    expect(JSON.stringify(sentPayloads[0])).toContain(
      'https://example.com/register',
    );

    await bot.handleUpdate({
      update_id: 11,
      callback_query: {
        id: 'callback-1',
        chat_instance: 'private',
        from: { id: 123, is_bot: false, first_name: 'Operator' },
        data: `networking:calendar:${eventId}`,
        message: {
          message_id: 10,
          date: 1_792_102_400,
          chat: { id: 123, type: 'private', first_name: 'Operator' },
          text: 'event',
        },
      },
    });

    expect(addEventToCalendar).toHaveBeenCalledWith(123n, 123n, eventId);
    expect(JSON.stringify(sentPayloads.at(-1))).toContain('mangovou barvou');
  });
});
