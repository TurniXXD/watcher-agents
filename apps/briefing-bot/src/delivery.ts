import {
  type BriefingDeliveryAttemptRecord,
  type BriefingDeliveryChannelId,
} from '@watcher/database';
import type { WatcherLogger } from '@watcher/core';
import { escapeHtml, optionalSourceLink } from '@watcher/telegram';
import type { TtsResult } from './tts.js';
import type { BriefingTelegramTransport } from './telegram-transport.js';
import type { WatchlistEarningsContext } from './stock-context.js';
import {
  briefingDayPeriodPresentation,
  type BriefingDayPeriod,
  isEndOfDayBriefing,
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
  earnings?: WatchlistEarningsContext;
  stockNews?: readonly BriefingIndexTopic[];
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
  indexMessageId?: string;
  fallbackMessageId?: string;
  failedChannels: BriefingDeliveryChannelId[];
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const durationLabel = (seconds: number): string => {
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
};

const telegramMessageLimit = 4096;

export const renderBriefingIndex = (index: BriefingIndex): string => {
  const period = briefingDayPeriodPresentation(index.dayPeriod);
  const lines = [
    `${period.icon} <b>${period.label} Briefing — ${escapeHtml(index.dateLabel)}</b>`,
  ];
  const append = (...additionalLines: string[]): boolean => {
    if ([...lines, ...additionalLines].join('\n').length > telegramMessageLimit)
      return false;
    lines.push(...additionalLines);
    return true;
  };

  if (index.location) append(`📍 ${escapeHtml(index.location)}`);
  if (index.audioDurationSeconds !== undefined) {
    append(`🎙 ${durationLabel(index.audioDurationSeconds)}`);
  }
  if (index.calendar.status === 'AVAILABLE') {
    const day = isEndOfDayBriefing(index.dayPeriod) ? 'tomorrow' : 'today';
    append(`🗓 ${index.calendar.count} events ${day}`);
  } else if (index.calendar.status === 'UNAVAILABLE') {
    append('🗓 Calendar unavailable');
  }
  if (index.earnings?.status === 'AVAILABLE') {
    const earnings = index.earnings.events;
    append('', '<b>📈 Watchlist earnings · next 14 days:</b>');
    if (earnings.length === 0) {
      append('None scheduled.');
    } else {
      const byDate = new Map<string, string[]>();
      for (const earning of earnings) {
        const tickers = byDate.get(earning.dateLabel) ?? [];
        tickers.push(earning.ticker);
        byDate.set(earning.dateLabel, tickers);
      }
      let shown = 0;
      for (const [dateLabel, tickers] of byDate) {
        if (
          !append(
            `• ${escapeHtml(dateLabel)} · ${tickers.map(escapeHtml).join(', ')}`,
          )
        )
          break;
        shown += tickers.length;
      }
      if (shown < earnings.length) {
        append(`• +${earnings.length - shown} more on the watchlist`);
      }
    }
  } else if (index.earnings?.status === 'UNAVAILABLE') {
    append(
      '',
      '<b>📈 Watchlist earnings · next 14 days:</b>',
      'Temporarily unavailable.',
    );
  }
  if (index.stockNews?.length) {
    let added = false;
    for (const topic of index.stockNews) {
      const url = topic.url;
      const safeUrl = url && /^https?:\/\//iu.test(url) ? url : undefined;
      const line = `• ${optionalSourceLink(topic.title, safeUrl)}`;
      if (
        !(added
          ? append(line)
          : append('', '<b>Highly relevant stock news:</b>', line))
      )
        break;
      added = true;
    }
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
      return this.deliverTextFallback(input, failedChannels);
    }
    const audio = input.audio;

    const voice = await this.attempt(input.runId, 'VOICE', async () => [
      await this.telegram.sendVoice(input.telegramChatId, {
        audio: audio.audio,
        fileName: audio.fileName,
        durationSeconds: audio.audioDurationSeconds,
      }),
    ]);
    if (!voice.success) {
      failedChannels.push('VOICE');
      return this.deliverTextFallback(input, failedChannels);
    }

    const index = await this.attempt(input.runId, 'INDEX', async () => [
      await this.telegram.sendIndex(input.telegramChatId, {
        html: renderBriefingIndex({
          ...input.index,
          audioDurationSeconds: audio.audioDurationSeconds,
        }),
        feedbackRunId: input.runId,
      }),
    ]);
    if (!index.success) failedChannels.push('INDEX');

    if (input.sendTranscript) {
      const transcript = await this.attempt(input.runId, 'TRANSCRIPT', () =>
        this.telegram.sendPlainText(input.telegramChatId, input.displayScript),
      );
      if (!transcript.success) failedChannels.push('TRANSCRIPT');
    }

    return {
      status: failedChannels.length === 0 ? 'SUCCESS' : 'PARTIAL',
      ...(voice.messageId ? { voiceMessageId: voice.messageId } : {}),
      ...(index.messageId ? { indexMessageId: index.messageId } : {}),
      failedChannels,
    };
  }

  private async deliverTextFallback(
    input: BriefingDeliveryInput,
    failedChannels: BriefingDeliveryChannelId[],
  ): Promise<BriefingDeliveryResult> {
    const fallback = await this.attempt(input.runId, 'TEXT_FALLBACK', () =>
      this.telegram.sendPlainText(input.telegramChatId, input.displayScript),
    );
    if (!fallback.success) failedChannels.push('TEXT_FALLBACK');
    const index = await this.attempt(input.runId, 'INDEX', async () => [
      await this.telegram.sendIndex(input.telegramChatId, {
        html: renderBriefingIndex(input.index),
        feedbackRunId: input.runId,
      }),
    ]);
    if (!index.success) failedChannels.push('INDEX');
    return {
      status: fallback.success || index.success ? 'PARTIAL' : 'FAILED',
      ...(fallback.messageId ? { fallbackMessageId: fallback.messageId } : {}),
      ...(index.messageId ? { indexMessageId: index.messageId } : {}),
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
