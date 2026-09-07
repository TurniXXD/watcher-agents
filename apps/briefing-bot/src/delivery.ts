import {
  type BriefingDeliveryAttemptRecord,
  type BriefingDeliveryChannelId,
} from '@watcher/database';
import type { WatcherLogger } from '@watcher/core';
import { escapeHtml, optionalSourceLink } from '@watcher/telegram';
import type { TtsResult } from './tts.js';
import type { BriefingTelegramTransport } from './telegram-transport.js';
import {
  briefingDayPeriodPresentation,
  type BriefingDayPeriod,
} from './utils/day-period.js';

export type BriefingIndexTopic = {
  title: string;
  url?: string;
};

type DeliveryAttempts = {
  successful: (
    runId: string,
    channel: BriefingDeliveryChannelId,
  ) => Promise<BriefingDeliveryAttemptRecord | undefined>;
  start: (
    runId: string,
    channel: BriefingDeliveryChannelId,
  ) => Promise<BriefingDeliveryAttemptRecord>;
  succeed: (
    attemptId: string,
    telegramMessageId: string,
  ) => Promise<BriefingDeliveryAttemptRecord>;
  fail: (
    attemptId: string,
    failureReason: string,
  ) => Promise<BriefingDeliveryAttemptRecord>;
};

export type BriefingIndex = {
  dateLabel: string;
  dayPeriod: BriefingDayPeriod;
  location?: string;
  audioDurationSeconds?: number;
  calendar: { status: 'AVAILABLE' | 'UNAVAILABLE' | 'DISABLED'; count: number };
  topics: readonly BriefingIndexTopic[];
};

export type BriefingDeliveryInput = {
  runId: string;
  telegramChatId: string;
  audio?: TtsResult;
  index: BriefingIndex;
  displayScript: string;
  sendTranscript: boolean;
};

export type BriefingDeliveryResult = {
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  voiceMessageId?: string;
  fallbackMessageId?: string;
  failedChannels: BriefingDeliveryChannelId[];
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const durationLabel = (seconds: number): string => {
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
};

const telegramCaptionLimit = 1024;

export const renderBriefingCaption = (index: BriefingIndex): string => {
  const period = briefingDayPeriodPresentation(index.dayPeriod);
  const lines = [
    `${period.icon} <b>${period.label} Briefing — ${escapeHtml(index.dateLabel)}</b>`,
  ];
  const append = (...additionalLines: string[]): boolean => {
    if ([...lines, ...additionalLines].join('\n').length > telegramCaptionLimit)
      return false;
    lines.push(...additionalLines);
    return true;
  };

  if (index.location) append(`📍 ${escapeHtml(index.location)}`);
  if (index.audioDurationSeconds !== undefined) {
    append(`🎙 ${durationLabel(index.audioDurationSeconds)}`);
  }
  if (index.calendar.status === 'AVAILABLE') {
    append(`🗓 ${index.calendar.count} events today`);
  } else if (index.calendar.status === 'UNAVAILABLE') {
    append('🗓 Calendar unavailable');
  }
  let topicAdded = false;
  for (const topic of index.topics.slice(0, 8)) {
    const topicLine = `• ${optionalSourceLink(topic.title, topic.url)}`;
    const added = topicAdded
      ? append(topicLine)
      : append('', '<b>Topics:</b>', topicLine);
    if (!added) break;
    topicAdded = true;
  }
  return lines.join('\n');
};

const defaultSleep = (durationMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

export class BriefingDeliveryService {
  public constructor(
    private readonly attempts: DeliveryAttempts,
    private readonly telegram: BriefingTelegramTransport,
    private readonly options: {
      maxAttempts?: number;
      baseDelayMs?: number;
      sleep?: (durationMs: number) => Promise<void>;
      logger?: WatcherLogger;
    } = {},
  ) {}

  public async deliver(
    input: BriefingDeliveryInput,
  ): Promise<BriefingDeliveryResult> {
    const failedChannels: BriefingDeliveryChannelId[] = [];
    if (!input.audio) {
      const fallback = await this.attempt(input.runId, 'TEXT_FALLBACK', () =>
        this.telegram.sendPlainText(input.telegramChatId, input.displayScript),
      );
      if (!fallback.success) failedChannels.push('TEXT_FALLBACK');
      return {
        status: fallback.success ? 'PARTIAL' : 'FAILED',
        ...(fallback.messageId
          ? { fallbackMessageId: fallback.messageId }
          : {}),
        failedChannels,
      };
    }
    const audio = input.audio;

    const voice = await this.attempt(input.runId, 'VOICE', async () => [
      await this.telegram.sendVoice(input.telegramChatId, {
        audio: audio.audio,
        fileName: audio.fileName,
        caption: renderBriefingCaption({
          ...input.index,
          audioDurationSeconds: audio.audioDurationSeconds,
        }),
        feedbackRunId: input.runId,
      }),
    ]);
    if (!voice.success) {
      failedChannels.push('VOICE');
      const fallback = await this.attempt(input.runId, 'TEXT_FALLBACK', () =>
        this.telegram.sendPlainText(input.telegramChatId, input.displayScript),
      );
      if (!fallback.success) failedChannels.push('TEXT_FALLBACK');
      return {
        status: fallback.success ? 'PARTIAL' : 'FAILED',
        ...(fallback.messageId
          ? { fallbackMessageId: fallback.messageId }
          : {}),
        failedChannels,
      };
    }

    if (input.sendTranscript) {
      const transcript = await this.attempt(input.runId, 'TRANSCRIPT', () =>
        this.telegram.sendPlainText(input.telegramChatId, input.displayScript),
      );
      if (!transcript.success) failedChannels.push('TRANSCRIPT');
    }

    return {
      status: failedChannels.length === 0 ? 'SUCCESS' : 'PARTIAL',
      ...(voice.messageId ? { voiceMessageId: voice.messageId } : {}),
      failedChannels,
    };
  }

  private async attempt(
    runId: string,
    channel: BriefingDeliveryChannelId,
    operation: () => Promise<string[]>,
  ): Promise<{ success: boolean; messageId?: string }> {
    const completed = await this.attempts.successful(runId, channel);
    if (completed) {
      this.options.logger?.info(
        { briefingRunId: runId, channel },
        'Skipping already completed briefing delivery channel',
      );
      return {
        success: true,
        ...(completed.telegramMessageId
          ? { messageId: completed.telegramMessageId }
          : {}),
      };
    }
    const maximum = this.options.maxAttempts ?? 3;
    const baseDelayMs = this.options.baseDelayMs ?? 1_000;
    const sleep = this.options.sleep ?? defaultSleep;
    for (let index = 0; index < maximum; index += 1) {
      const attempt = await this.attempts.start(runId, channel);
      const startedAt = Date.now();
      this.options.logger?.debug(
        {
          briefingRunId: runId,
          channel,
          attempt: index + 1,
          maximumAttempts: maximum,
        },
        'Starting briefing delivery attempt',
      );
      try {
        const messageIds = await operation();
        const messageId = messageIds[0];
        if (!messageId) throw new Error('Telegram returned no message ID');
        await this.attempts.succeed(attempt.id, messageId);
        this.options.logger?.info(
          {
            briefingRunId: runId,
            channel,
            attempt: index + 1,
            durationMs: Date.now() - startedAt,
          },
          'Briefing delivery channel succeeded',
        );
        return { success: true, messageId };
      } catch (error) {
        await this.attempts.fail(attempt.id, errorMessage(error));
        this.options.logger?.warn(
          {
            err: error,
            briefingRunId: runId,
            channel,
            attempt: index + 1,
            maximumAttempts: maximum,
            durationMs: Date.now() - startedAt,
          },
          'Briefing delivery attempt failed',
        );
        if (index + 1 < maximum) {
          await sleep(baseDelayMs * 2 ** index);
        }
      }
    }
    return { success: false };
  }
}
