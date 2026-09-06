import { z } from 'zod';
import {
  BriefingDeliveryChannel,
  BriefingDeliveryStatus,
} from './generated/prisma/enums.js';
import type { DatabaseClient } from './client.js';

export const deliveryChannelSchema = z.enum([
  'VOICE',
  'INDEX',
  'TRANSCRIPT',
  'TEXT_FALLBACK',
]);

export type BriefingDeliveryChannelId = z.infer<typeof deliveryChannelSchema>;

export type BriefingDeliveryAttemptRecord = {
  id: string;
  runId: string;
  channel: BriefingDeliveryChannelId;
  attempt: number;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  telegramMessageId?: string;
  failureReason?: string;
};

const toRecord = (attempt: {
  id: string;
  runId: string;
  channel: BriefingDeliveryChannel;
  attempt: number;
  status: BriefingDeliveryStatus;
  telegramMessageId: string | null;
  failureReason: string | null;
}): BriefingDeliveryAttemptRecord => ({
  id: attempt.id,
  runId: attempt.runId,
  channel: attempt.channel,
  attempt: attempt.attempt,
  status: attempt.status,
  ...(attempt.telegramMessageId
    ? { telegramMessageId: attempt.telegramMessageId }
    : {}),
  ...(attempt.failureReason ? { failureReason: attempt.failureReason } : {}),
});

export class BriefingDeliveryStore {
  public constructor(private readonly db: DatabaseClient) {}

  public async successful(
    runId: string,
    rawChannel: unknown,
  ): Promise<BriefingDeliveryAttemptRecord | undefined> {
    const channel = deliveryChannelSchema.parse(rawChannel);
    const attempt = await this.db.briefingDeliveryAttempt.findFirst({
      where: {
        runId,
        channel: BriefingDeliveryChannel[channel],
        status: BriefingDeliveryStatus.SUCCESS,
      },
      orderBy: { attempt: 'desc' },
    });
    return attempt ? toRecord(attempt) : undefined;
  }

  public async start(
    runId: string,
    rawChannel: unknown,
  ): Promise<BriefingDeliveryAttemptRecord> {
    const channel = deliveryChannelSchema.parse(rawChannel);
    return this.db.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`briefing-delivery:${runId}:${channel}`}))`;
      const latest = await transaction.briefingDeliveryAttempt.aggregate({
        where: { runId, channel: BriefingDeliveryChannel[channel] },
        _max: { attempt: true },
      });
      const created = await transaction.briefingDeliveryAttempt.create({
        data: {
          runId,
          channel: BriefingDeliveryChannel[channel],
          attempt: (latest._max.attempt ?? 0) + 1,
        },
      });
      return toRecord(created);
    });
  }

  public async succeed(
    attemptId: string,
    telegramMessageId: string,
  ): Promise<BriefingDeliveryAttemptRecord> {
    const attempt = await this.db.briefingDeliveryAttempt.update({
      where: { id: attemptId },
      data: {
        status: BriefingDeliveryStatus.SUCCESS,
        telegramMessageId: telegramMessageId.slice(0, 200),
        completedAt: new Date(),
        failureReason: null,
      },
    });
    return toRecord(attempt);
  }

  public async fail(
    attemptId: string,
    failureReason: string,
  ): Promise<BriefingDeliveryAttemptRecord> {
    const attempt = await this.db.briefingDeliveryAttempt.update({
      where: { id: attemptId },
      data: {
        status: BriefingDeliveryStatus.FAILED,
        failureReason: failureReason
          .replaceAll(/\s+/g, ' ')
          .trim()
          .slice(0, 2_000),
        completedAt: new Date(),
      },
    });
    return toRecord(attempt);
  }
}
