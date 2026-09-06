import { computeNextRun } from '@watcher/core';
import type { DatabaseClient } from './client.js';

export type DueBriefingSchedule = {
  id: string;
  telegramChatId: bigint;
  scheduledFor: Date;
};

const cronForTime = (briefingTime: string): string => {
  const [hour, minute] = briefingTime.split(':').map(Number);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour === undefined ||
    hour < 0 ||
    hour > 23 ||
    minute === undefined ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error(`Invalid briefing time: ${briefingTime}`);
  }
  return `${minute} ${hour} * * *`;
};

const nextFor = (briefingTime: string, timezone: string, after: Date): Date =>
  computeNextRun(cronForTime(briefingTime), timezone, after);

export class BriefingScheduleStore {
  public constructor(private readonly db: DatabaseClient) {}

  public async initializeMissing(now = new Date()): Promise<number> {
    const missing = await this.db.briefingSettings.findMany({
      where: { onboardingComplete: true, nextBriefingAt: null },
      select: { id: true, briefingTime: true, timezone: true },
    });
    await Promise.all(
      missing.map((settings) =>
        this.db.briefingSettings.updateMany({
          where: { id: settings.id, nextBriefingAt: null },
          data: {
            nextBriefingAt: nextFor(
              settings.briefingTime,
              settings.timezone,
              now,
            ),
          },
        }),
      ),
    );
    return missing.length;
  }

  public async claimDue(
    now = new Date(),
    limit = 10,
  ): Promise<DueBriefingSchedule[]> {
    await this.initializeMissing(now);
    return this.db.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('briefing-scheduler'))`;
      const due = await transaction.briefingSettings.findMany({
        where: {
          onboardingComplete: true,
          nextBriefingAt: { lte: now },
        },
        orderBy: { nextBriefingAt: 'asc' },
        take: Math.min(100, Math.max(1, Math.trunc(limit))),
      });
      for (const settings of due) {
        await transaction.briefingSettings.update({
          where: { id: settings.id },
          data: {
            nextBriefingAt: nextFor(
              settings.briefingTime,
              settings.timezone,
              now,
            ),
          },
        });
      }
      return due.flatMap((settings) =>
        settings.nextBriefingAt
          ? [
              {
                id: settings.id,
                telegramChatId: settings.telegramChatId,
                scheduledFor: settings.nextBriefingAt,
              },
            ]
          : [],
      );
    });
  }
}
