import type { DatabaseClient } from './client.js';
import {
  briefingOccurrenceAt,
  nextBriefingOccurrence,
} from './briefing-schedule-spec.js';

export type DueBriefingSchedule = {
  id: string;
  telegramChatId: bigint;
  scheduledFor: Date;
  scheduleKey: string;
  scheduleLabel: string;
  periodHours?: number;
};

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
            nextBriefingAt: nextBriefingOccurrence(
              settings.briefingTime,
              settings.timezone,
              now,
            ).scheduledFor,
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
            nextBriefingAt: nextBriefingOccurrence(
              settings.briefingTime,
              settings.timezone,
              now,
            ).scheduledFor,
          },
        });
      }
      return due.flatMap((settings) => {
        if (!settings.nextBriefingAt) return [];
        const occurrence = briefingOccurrenceAt(
          settings.briefingTime,
          settings.timezone,
          settings.nextBriefingAt,
        );
        return [
          {
            id: settings.id,
            telegramChatId: settings.telegramChatId,
            scheduledFor: settings.nextBriefingAt,
            scheduleKey: occurrence.entry.key,
            scheduleLabel: occurrence.entry.label,
            ...(occurrence.entry.periodHours === undefined
              ? {}
              : { periodHours: occurrence.entry.periodHours }),
          },
        ];
      });
    });
  }
}
