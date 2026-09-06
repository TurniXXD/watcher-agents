import type {
  BriefingDeliveryAttemptRecord,
  BriefingDeliveryChannelId,
} from '@watcher/database';
import { describe, expect, it, vi } from 'vitest';
import {
  BriefingDeliveryService,
  renderBriefingIndex,
  type BriefingDeliveryInput,
} from '../delivery.js';
import type { BriefingTelegramTransport } from '../telegram-transport.js';

class MemoryAttempts {
  public readonly records: BriefingDeliveryAttemptRecord[] = [];

  public async successful(runId: string, channel: BriefingDeliveryChannelId) {
    return this.records.find(
      (record) =>
        record.runId === runId &&
        record.channel === channel &&
        record.status === 'SUCCESS',
    );
  }

  public async start(runId: string, channel: BriefingDeliveryChannelId) {
    const attempt =
      this.records.filter(
        (record) => record.runId === runId && record.channel === channel,
      ).length + 1;
    const record: BriefingDeliveryAttemptRecord = {
      id: `${channel}-${attempt}`,
      runId,
      channel,
      attempt,
      status: 'RUNNING',
    };
    this.records.push(record);
    return record;
  }

  public async succeed(attemptId: string, telegramMessageId: string) {
    const record = this.record(attemptId);
    record.status = 'SUCCESS';
    record.telegramMessageId = telegramMessageId;
    return record;
  }

  public async fail(attemptId: string, failureReason: string) {
    const record = this.record(attemptId);
    record.status = 'FAILED';
    record.failureReason = failureReason;
    return record;
  }

  private record(id: string): BriefingDeliveryAttemptRecord {
    const record = this.records.find((candidate) => candidate.id === id);
    if (!record) throw new Error(`Unknown attempt ${id}`);
    return record;
  }
}

const input = (): BriefingDeliveryInput => ({
  runId: 'run-1',
  telegramChatId: '123',
  audio: {
    audio: new Uint8Array([1, 2, 3]),
    mimeType: 'audio/ogg',
    fileName: 'briefing.ogg',
    voice: 'amy',
    chunkCount: 1,
    generationDurationMs: 500,
    audioDurationSeconds: 582,
  },
  index: {
    dateLabel: 'Sep 6',
    location: 'Brno',
    calendar: { status: 'AVAILABLE', count: 3 },
    topics: ['Merck Phase III results', 'Micron catalyst update'],
  },
  displayScript: 'Good morning. Full readable briefing.',
  sendTranscript: true,
});

const transport = (): BriefingTelegramTransport => ({
  sendVoice: vi.fn(async () => '101'),
  sendHtml: vi.fn(async () => ['102']),
  sendPlainText: vi.fn(async () => ['103']),
});

describe('BriefingDeliveryService', () => {
  it('sends voice, compact index, and optional transcript in order', async () => {
    const attempts = new MemoryAttempts();
    const telegram = transport();
    const service = new BriefingDeliveryService(attempts, telegram);

    const result = await service.deliver(input());

    expect(result).toEqual({
      status: 'SUCCESS',
      voiceMessageId: '101',
      failedChannels: [],
    });
    expect(attempts.records.map(({ channel }) => channel)).toEqual([
      'VOICE',
      'INDEX',
      'TRANSCRIPT',
    ]);
    expect(telegram.sendHtml).toHaveBeenCalledWith(
      '123',
      expect.stringContaining('🎙 9:42'),
    );
  });

  it('retries a failed voice upload exponentially and falls back to text', async () => {
    const attempts = new MemoryAttempts();
    const telegram = transport();
    vi.mocked(telegram.sendVoice).mockRejectedValue(
      new Error('Telegram upload failed'),
    );
    const sleep = vi.fn(async () => undefined);
    const service = new BriefingDeliveryService(attempts, telegram, {
      maxAttempts: 3,
      baseDelayMs: 10,
      sleep,
    });

    const result = await service.deliver(input());

    expect(result).toEqual({
      status: 'PARTIAL',
      fallbackMessageId: '103',
      failedChannels: ['VOICE'],
    });
    expect(telegram.sendVoice).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 10);
    expect(sleep).toHaveBeenNthCalledWith(2, 20);
    expect(telegram.sendHtml).not.toHaveBeenCalled();
  });

  it('does not resend channels already persisted as successful', async () => {
    const attempts = new MemoryAttempts();
    const telegram = transport();
    const service = new BriefingDeliveryService(attempts, telegram);
    const request = input();

    await service.deliver(request);
    await service.deliver(request);

    expect(telegram.sendVoice).toHaveBeenCalledTimes(1);
    expect(telegram.sendHtml).toHaveBeenCalledTimes(1);
    expect(telegram.sendPlainText).toHaveBeenCalledTimes(1);
  });

  it('uses text directly when TTS is unavailable', async () => {
    const attempts = new MemoryAttempts();
    const telegram = transport();
    const service = new BriefingDeliveryService(attempts, telegram);
    const request = input();
    delete request.audio;

    expect(await service.deliver(request)).toEqual({
      status: 'PARTIAL',
      fallbackMessageId: '103',
      failedChannels: [],
    });
    expect(telegram.sendVoice).not.toHaveBeenCalled();
    expect(attempts.records[0]?.channel).toBe('TEXT_FALLBACK');
  });
});

describe('renderBriefingIndex', () => {
  it('escapes user-facing values and reports unavailable Calendar honestly', () => {
    const rendered = renderBriefingIndex({
      dateLabel: '<Sep 6>',
      location: 'Brno & okolí',
      calendar: { status: 'UNAVAILABLE', count: 0 },
      topics: ['A < B'],
    });

    expect(rendered).toContain('&lt;Sep 6&gt;');
    expect(rendered).toContain('Brno &amp; okolí');
    expect(rendered).toContain('Calendar unavailable');
    expect(rendered).not.toContain('0 events today');
  });
});
