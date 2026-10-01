import type { OsintStore } from '@watcher/database';
import { describe, expect, it, vi } from 'vitest';
import type { OsintService } from '../service.js';
import { createOsintBot, osintHelp } from '../bot.js';

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

describe('OSINT bot help', () => {
  it.each(['/start', '/help'])(
    'serves the detailed guide for %s',
    async (command) => {
      const bot = createOsintBot(
        'test-token',
        new Set([123]),
        {} as OsintStore,
        {} as OsintService,
      );
      bot.botInfo = {
        id: 456,
        is_bot: true,
        first_name: 'OSINT Bot',
        username: 'osint_test_bot',
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
      expect(send.mock.calls[0]?.[0]).toMatchObject({ text: osintHelp });
    },
  );

  it('documents every OSINT command group and evidence boundaries', () => {
    for (const command of [
      '/investigate <dotaz>',
      '/investigations',
      '/investigation [id]',
      '/report [id]',
      '/evidence <id>',
      '/entity <id>',
      '/relations [id]',
      '/timeline [id]',
      '/expand <IČO/doména/ID entity>',
      '/search <IČO nebo doména>',
      '/sources',
      '/watch [id]',
      '/unwatch [id]',
      '/pause [id]',
      '/resume [id]',
      '/stop [id]',
    ]) {
      expect(osintHelp).toContain(command);
    }
    expect(osintHelp).toContain('Výstup Ollamy je označená interpretace');
  });
});
