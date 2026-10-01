import type { SalesStore } from '@watcher/database';
import { describe, expect, it, vi } from 'vitest';
import type { SalesService } from '../service.js';
import {
  createSalesBot,
  salesAbout,
  salesBotCommands,
  salesHelp,
} from '../bot.js';

const update = (text: string, updateId: number) => ({
  update_id: updateId,
  message: {
    message_id: updateId,
    date: 1_788_704_068,
    chat: { id: 123, type: 'private' as const, first_name: 'Operator' },
    from: { id: 123, is_bot: false, first_name: 'Operator' },
    text,
    entities: [
      { offset: 0, length: text.length, type: 'bot_command' as const },
    ],
  },
});

describe('sales bot help', () => {
  it.each(['/start', '/help', '/sales_help'])(
    'serves the detailed guide for %s',
    async (command) => {
      const bot = createSalesBot(
        'test-token',
        new Set([123]),
        {} as SalesStore,
        {} as SalesService,
      );
      bot.botInfo = {
        id: 456,
        is_bot: true,
        first_name: 'Sales Bot',
        username: 'sales_test_bot',
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

      await bot.handleUpdate(update(command, command.length));

      expect(send).toHaveBeenCalledOnce();
      expect(send.mock.calls[0]?.[0]).toMatchObject({ text: salesHelp });
    },
  );

  it.each(['/about', '/sales_about'])(
    'serves the detailed about text for %s',
    async (command) => {
      const bot = createSalesBot(
        'test-token',
        new Set([123]),
        {} as SalesStore,
        {} as SalesService,
      );
      bot.botInfo = {
        id: 456,
        is_bot: true,
        first_name: 'Sales Bot',
        username: 'sales_test_bot',
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

      await bot.handleUpdate(update(command, command.length + 100));

      expect(send).toHaveBeenCalledOnce();
      expect(send.mock.calls[0]?.[0]).toMatchObject({ text: salesAbout });
    },
  );

  it('documents every sales command and the approval boundary', () => {
    for (const command of [
      '/sales_status',
      '/sales_leads',
      '/sales_lead <id>',
      '/sales_approve <id>',
      '/sales_reject <id>',
      '/sales_run',
    ]) {
      expect(salesHelp).toContain(command);
    }
    expect(salesHelp).toContain('does not establish consent');
    expect(salesHelp).toContain('/about or /sales_about');
  });

  it('publishes the detailed about command in the Telegram menu', () => {
    expect(salesBotCommands).toContainEqual(
      expect.objectContaining({ command: 'sales_about' }),
    );
    expect(salesAbout).toContain('RECIPIENT_OPT_IN');
    expect(salesAbout).toContain('Twenty CRM');
    expect(salesAbout).toContain('Quickly');
  });
});
