import type { DatabaseClient } from './client.js';
import { TelegramOutboxStatus } from './generated/prisma/enums.js';

export const trading212ScheduledKind = 'TRADING212_SCHEDULED_POSITIONS';

export class Trading212ScheduleStore {
  public constructor(private readonly db: DatabaseClient) {}

  public async enabled(chatId: bigint): Promise<boolean> {
    const schedule = await this.db.trading212Schedule.findUnique({
      where: { chatId },
      select: { enabled: true },
    });
    return schedule?.enabled ?? false;
  }

  public async setEnabled(chatId: bigint, enabled: boolean): Promise<void> {
    await this.db.$transaction(async (transaction) => {
      await transaction.trading212Schedule.upsert({
        where: { chatId },
        create: { chatId, enabled },
        update: { enabled },
      });
      if (!enabled) {
        await transaction.telegramOutboxMessage.updateMany({
          where: {
            kind: trading212ScheduledKind,
            telegramChatId: chatId,
            status: TelegramOutboxStatus.PENDING,
          },
          data: {
            status: TelegramOutboxStatus.DEAD_LETTER,
            lastError: 'Trading 212 schedule disabled by owner',
          },
        });
      }
    });
  }
}
