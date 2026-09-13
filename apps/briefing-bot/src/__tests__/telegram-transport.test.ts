import type { Api } from 'grammy';
import { describe, expect, it, vi } from 'vitest';
import { GrammyBriefingTransport } from '../telegram-transport.js';

describe('GrammyBriefingTransport', () => {
  it('supplies Telegram with voice duration and keeps the index out of the voice caption', async () => {
    const sendVoice = vi.fn(
      async (...arguments_: [string, unknown, Record<string, unknown>]) => {
        void arguments_;
        return { message_id: 101 };
      },
    );
    const sendMessage = vi.fn(
      async (...arguments_: [string, string, Record<string, unknown>]) => {
        void arguments_;
        return { message_id: 102 };
      },
    );
    const transport = new GrammyBriefingTransport({
      sendVoice,
      sendMessage,
    } as unknown as Api);

    await expect(
      transport.sendVoice('123', {
        audio: new Uint8Array([1, 2, 3]),
        fileName: 'briefing.ogg',
        durationSeconds: 355.4,
      }),
    ).resolves.toBe('101');

    expect(sendVoice).toHaveBeenCalledOnce();
    expect(sendVoice.mock.calls[0]?.[2]).toEqual({ duration: 355 });
    expect(sendVoice.mock.calls[0]?.[2]).not.toHaveProperty('caption');

    await expect(
      transport.sendIndex('123', {
        html: '<b>Morning Briefing</b>\n\n<b>Topics:</b>\n• Item',
        feedbackRunId: 'run-1',
      }),
    ).resolves.toBe('102');

    expect(sendMessage.mock.calls[0]?.[1]).toContain('<b>Topics:</b>');
    expect(sendMessage.mock.calls[0]?.[2]).toMatchObject({
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  });
});
