import { randomUUID } from 'node:crypto';
import { TelegramOutboxStatus } from './generated/prisma/enums.js';
import type { DatabaseClient } from './client.js';

const defaultLeaseMs = 5 * 60_000;

export type TelegramOutboxMessage = {
  id: string;
  kind: string;
  deduplicationKey: string;
  chatId: bigint;
  body: string;
  attemptCount: number;
  leaseToken: string;
};

export type EnqueueTelegramOutboxMessage = {
  kind: string;
  deduplicationKey: string;
  chatId: bigint;
  body: string;
};

type OutboxRow = {
  id: string;
  kind: string;
  deduplicationKey: string;
  telegramChatId: bigint;
  body: string;
  attemptCount: number;
  leaseToken: string | null;
};

const normalizeError = (error: string): string =>
  error.replaceAll(/\s+/g, ' ').trim().slice(0, 2_000);

const toMessage = (row: OutboxRow): TelegramOutboxMessage => {
  if (!row.leaseToken) {
    throw new Error(`Outbox message ${row.id} was claimed without a lease.`);
  }
  return {
    id: row.id,
    kind: row.kind,
    deduplicationKey: row.deduplicationKey,
    chatId: row.telegramChatId,
    body: row.body,
    attemptCount: row.attemptCount,
    leaseToken: row.leaseToken,
  };
};

export class TelegramOutboxStore {
  public constructor(private readonly db: DatabaseClient) {}

  public async enqueue(input: EnqueueTelegramOutboxMessage): Promise<void> {
    await this.db.telegramOutboxMessage.upsert({
      where: {
        kind_deduplicationKey: {
          kind: input.kind,
          deduplicationKey: input.deduplicationKey,
        },
      },
      create: {
        kind: input.kind,
        deduplicationKey: input.deduplicationKey,
        telegramChatId: input.chatId,
        body: input.body,
      },
      update: {},
    });
  }

  public async claimDue(
    now = new Date(),
    limit = 10,
    leaseMs = defaultLeaseMs,
  ): Promise<TelegramOutboxMessage[]> {
    const candidates = await this.db.telegramOutboxMessage.findMany({
      where: {
        OR: [
          {
            status: TelegramOutboxStatus.PENDING,
            nextAttemptAt: { lte: now },
          },
          {
            status: TelegramOutboxStatus.SENDING,
            leaseExpiresAt: { lt: now },
          },
        ],
      },
      select: { id: true, status: true },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
    });
    const leaseExpiresAt = new Date(now.getTime() + leaseMs);
    const claimed = await Promise.all(
      candidates.map(async (candidate) => {
        const leaseToken = randomUUID();
        return this.db.$transaction(async (transaction) => {
          const claim = await transaction.telegramOutboxMessage.updateMany({
            where:
              candidate.status === TelegramOutboxStatus.PENDING
                ? {
                    id: candidate.id,
                    status: TelegramOutboxStatus.PENDING,
                    nextAttemptAt: { lte: now },
                  }
                : {
                    id: candidate.id,
                    status: TelegramOutboxStatus.SENDING,
                    leaseExpiresAt: { lt: now },
                  },
            data: {
              status: TelegramOutboxStatus.SENDING,
              leaseToken,
              leaseExpiresAt,
              attemptCount: { increment: 1 },
            },
          });
          if (claim.count === 0) return undefined;
          const row = await transaction.telegramOutboxMessage.findUniqueOrThrow(
            {
              where: { id: candidate.id },
              select: {
                id: true,
                kind: true,
                deduplicationKey: true,
                telegramChatId: true,
                body: true,
                attemptCount: true,
                leaseToken: true,
              },
            },
          );
          return toMessage(row);
        });
      }),
    );
    return claimed.filter(
      (message): message is TelegramOutboxMessage => message !== undefined,
    );
  }

  public async markDelivered(
    message: TelegramOutboxMessage,
    telegramMessageId: string,
    now = new Date(),
  ): Promise<boolean> {
    const result = await this.db.telegramOutboxMessage.updateMany({
      where: {
        id: message.id,
        status: TelegramOutboxStatus.SENDING,
        leaseToken: message.leaseToken,
      },
      data: {
        status: TelegramOutboxStatus.SENT,
        leaseToken: null,
        leaseExpiresAt: null,
        telegramMessageId: telegramMessageId.slice(0, 200),
        lastError: null,
        sentAt: now,
      },
    });
    return result.count === 1;
  }

  public async markFailed(
    message: TelegramOutboxMessage,
    error: string,
    retryAt?: Date,
  ): Promise<boolean> {
    const result = await this.db.telegramOutboxMessage.updateMany({
      where: {
        id: message.id,
        status: TelegramOutboxStatus.SENDING,
        leaseToken: message.leaseToken,
      },
      data: {
        status: retryAt
          ? TelegramOutboxStatus.PENDING
          : TelegramOutboxStatus.DEAD_LETTER,
        leaseToken: null,
        leaseExpiresAt: null,
        nextAttemptAt: retryAt ?? new Date(),
        lastError: normalizeError(error),
      },
    });
    return result.count === 1;
  }
}
