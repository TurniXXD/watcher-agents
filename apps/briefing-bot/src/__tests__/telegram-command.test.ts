import { describe, expect, it } from 'vitest';
import { normalizeHyphenatedBotCommand } from '../utils/telegram-command.js';

describe('normalizeHyphenatedBotCommand', () => {
  it('turns a legacy hyphenated command into a Telegram-valid command', () => {
    const message = {
      text: '/voice-set amy',
      entities: [{ offset: 0, length: 6, type: 'bot_command' }],
    };

    normalizeHyphenatedBotCommand(message);

    expect(message).toEqual({
      text: '/voice_set amy',
      entities: [{ offset: 0, length: 10, type: 'bot_command' }],
    });
  });

  it('preserves a bot username and native underscore commands', () => {
    const legacy = {
      text: '/calendar-connect@briefing_test_bot',
      entities: [{ offset: 0, length: 9, type: 'bot_command' }],
    };
    const native = {
      text: '/briefing_time 07:30',
      entities: [{ offset: 0, length: 14, type: 'bot_command' }],
    };

    normalizeHyphenatedBotCommand(legacy);
    normalizeHyphenatedBotCommand(native);

    expect(legacy.text).toBe('/calendar_connect@briefing_test_bot');
    expect(legacy.entities[0]?.length).toBe(35);
    expect(native.text).toBe('/briefing_time 07:30');
    expect(native.entities[0]?.length).toBe(14);
  });
});
