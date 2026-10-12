import { computeNextRun } from '@watcher/core';
import { z } from 'zod';
import type { DatabaseClient } from './client.js';
import { Prisma } from './generated/prisma/client.js';

export const journalSectionsSchema = z.object({
  experienced: z.string().default(''),
  joy: z.string().default(''),
  challenges: z.string().default(''),
  learned: z.string().default(''),
  changes: z.string().default(''),
  priority: z.string().default(''),
});

export type JournalSections = z.infer<typeof journalSectionsSchema>;
export type JournalSessionRecord = {
  id: string;
  telegramChatId: bigint;
  telegramUserId: bigint;
  journalDate: string;
  mode?: 'TEXT' | 'VOICE';
  status:
    | 'REMINDER_PENDING'
    | 'IN_PROGRESS'
    | 'AWAITING_CONFIRMATION'
    | 'COMPLETED'
    | 'SKIPPED'
    | 'CANCELLED';
  currentQuestion: number;
  answers: JournalSections;
  transcript?: string;
  draft?: JournalSections;
  reminderAt: Date;
  reminderSentAt?: Date;
  syncStatus: 'NOT_READY' | 'PENDING' | 'SYNCED' | 'FAILED' | 'CONFLICT';
  syncAttempts: number;
  notionPageId?: string;
  notionPageUrl?: string;
  syncedAnswers?: JournalSections;
  syncError?: string;
};

const localDate = (now: Date, timezone: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

export const journalReminderInstant = (
  date: string,
  time: string,
  timezone: string,
): Date => {
  const [hour, minute] = time.split(':').map(Number);
  if (hour === undefined || minute === undefined) {
    throw new Error(`Invalid journal reminder time: ${time}`);
  }
  const cron = `${minute} ${hour} * * *`;
  let cursor = new Date(`${date}T00:00:00.000Z`);
  cursor = new Date(cursor.getTime() - 36 * 60 * 60_000);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidate = computeNextRun(cron, timezone, cursor);
    if (localDate(candidate, timezone) === date) return candidate;
    cursor = candidate;
  }
  throw new Error(`Could not resolve journal reminder for ${date}`);
};

const toRecord = (row: {
  id: string;
  telegramUserId: bigint;
  journalDate: string;
  mode: 'TEXT' | 'VOICE' | null;
  status: JournalSessionRecord['status'];
  currentQuestion: number;
  answers: unknown;
  transcript: string | null;
  draft: unknown;
  reminderAt: Date;
  reminderSentAt: Date | null;
  syncStatus: JournalSessionRecord['syncStatus'];
  syncAttempts: number;
  notionPageId: string | null;
  notionPageUrl: string | null;
  syncedAnswers: unknown;
  syncError: string | null;
  settings: { telegramChatId: bigint };
}): JournalSessionRecord => ({
  id: row.id,
  telegramChatId: row.settings.telegramChatId,
  telegramUserId: row.telegramUserId,
  journalDate: row.journalDate,
  ...(row.mode ? { mode: row.mode } : {}),
  status: row.status,
  currentQuestion: row.currentQuestion,
  answers: journalSectionsSchema.parse(row.answers),
  ...(row.transcript ? { transcript: row.transcript } : {}),
  ...(row.draft ? { draft: journalSectionsSchema.parse(row.draft) } : {}),
  reminderAt: row.reminderAt,
  ...(row.reminderSentAt ? { reminderSentAt: row.reminderSentAt } : {}),
  syncStatus: row.syncStatus,
  syncAttempts: row.syncAttempts,
  ...(row.notionPageId ? { notionPageId: row.notionPageId } : {}),
  ...(row.notionPageUrl ? { notionPageUrl: row.notionPageUrl } : {}),
  ...(row.syncedAnswers
    ? { syncedAnswers: journalSectionsSchema.parse(row.syncedAnswers) }
    : {}),
  ...(row.syncError ? { syncError: row.syncError } : {}),
});

const includeSettings = {
  settings: { select: { telegramChatId: true } },
} as const;

export class JournalSessionStore {
  public constructor(private readonly db: DatabaseClient) {}

  public async ensure(
    telegramChatId: bigint,
    telegramUserId: bigint,
    journalDate: string,
    reminderAt: Date,
  ): Promise<JournalSessionRecord> {
    const settings = await this.db.briefingSettings.upsert({
      where: { telegramChatId },
      create: { telegramChatId },
      update: {},
    });
    const row = await this.db.journalSession.upsert({
      where: {
        settingsId_telegramUserId_journalDate: {
          settingsId: settings.id,
          telegramUserId,
          journalDate,
        },
      },
      create: {
        settingsId: settings.id,
        telegramUserId,
        journalDate,
        reminderAt,
      },
      update: {},
      include: includeSettings,
    });
    return toRecord(row);
  }

  public async getById(
    id: string,
    telegramChatId: bigint,
    telegramUserId: bigint,
  ): Promise<JournalSessionRecord | undefined> {
    const row = await this.db.journalSession.findFirst({
      where: { id, telegramUserId, settings: { telegramChatId } },
      include: includeSettings,
    });
    return row ? toRecord(row) : undefined;
  }

  public async getLatest(
    telegramChatId: bigint,
    telegramUserId: bigint,
  ): Promise<JournalSessionRecord | undefined> {
    const row = await this.db.journalSession.findFirst({
      where: { telegramUserId, settings: { telegramChatId } },
      orderBy: [{ journalDate: 'desc' }, { updatedAt: 'desc' }],
      include: includeSettings,
    });
    return row ? toRecord(row) : undefined;
  }

  public async initializeDaily(
    now: Date,
    reminderTime: string,
    timezone: string,
  ): Promise<void> {
    const date = localDate(now, timezone);
    const reminderAt = journalReminderInstant(date, reminderTime, timezone);
    const settings = await this.db.briefingSettings.findMany({
      where: { onboardingComplete: true },
      select: { id: true, telegramChatId: true },
    });
    await this.db.journalSession.createMany({
      data: settings.map((item) => ({
        settingsId: item.id,
        telegramUserId: item.telegramChatId,
        journalDate: date,
        reminderAt,
      })),
      skipDuplicates: true,
    });
  }

  public async claimDueReminders(
    now: Date,
    reminderTime: string,
    timezone: string,
    maximumDelayMs = 6 * 60 * 60_000,
  ): Promise<JournalSessionRecord[]> {
    await this.initializeDaily(now, reminderTime, timezone);
    const earliest = new Date(now.getTime() - maximumDelayMs);
    const leaseUntil = new Date(now.getTime() + 2 * 60_000);
    return this.db.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('journal-reminder-scheduler'))`;
      const rows = await transaction.journalSession.findMany({
        where: {
          status: 'REMINDER_PENDING',
          reminderAt: { gte: earliest, lte: now },
          reminderSentAt: null,
          OR: [
            { reminderLeaseUntil: null },
            { reminderLeaseUntil: { lt: now } },
          ],
        },
        orderBy: { reminderAt: 'asc' },
        take: 25,
        include: includeSettings,
      });
      if (rows.length) {
        await transaction.journalSession.updateMany({
          where: { id: { in: rows.map(({ id }) => id) } },
          data: { reminderLeaseUntil: leaseUntil },
        });
      }
      return rows.map(toRecord);
    });
  }

  public async markReminderSent(
    id: string,
    sentAt = new Date(),
  ): Promise<void> {
    await this.db.journalSession.update({
      where: { id },
      data: { reminderSentAt: sentAt, reminderLeaseUntil: null },
    });
  }

  public async releaseReminder(id: string): Promise<void> {
    await this.db.journalSession.update({
      where: { id },
      data: { reminderLeaseUntil: null },
    });
  }

  public async start(
    id: string,
    mode: 'TEXT' | 'VOICE',
  ): Promise<JournalSessionRecord> {
    return toRecord(
      await this.db.journalSession.update({
        where: { id },
        data: { mode, status: 'IN_PROGRESS' },
        include: includeSettings,
      }),
    );
  }

  public async saveProgress(
    id: string,
    answers: JournalSections,
    currentQuestion: number,
    status: 'IN_PROGRESS' | 'AWAITING_CONFIRMATION',
    expected?: {
      currentQuestion: number;
      status: 'IN_PROGRESS' | 'AWAITING_CONFIRMATION';
    },
  ): Promise<JournalSessionRecord> {
    const data = { answers, currentQuestion, status } as const;
    if (expected) {
      const result = await this.db.journalSession.updateMany({
        where: {
          id,
          currentQuestion: expected.currentQuestion,
          status: expected.status,
        },
        data,
      });
      if (result.count !== 1) {
        throw new Error('Journal session changed concurrently; reload it');
      }
    } else {
      await this.db.journalSession.update({ where: { id }, data });
    }
    return toRecord(
      await this.db.journalSession.findUniqueOrThrow({
        where: { id },
        include: includeSettings,
      }),
    );
  }

  public async saveVoiceDraft(
    id: string,
    transcript: string,
    draft: JournalSections,
  ): Promise<JournalSessionRecord> {
    return toRecord(
      await this.db.journalSession.update({
        where: { id },
        data: {
          transcript,
          draft,
          answers: draft,
          status: 'AWAITING_CONFIRMATION',
        },
        include: includeSettings,
      }),
    );
  }

  public async postpone(id: string, until: Date): Promise<void> {
    await this.db.journalSession.update({
      where: { id },
      data: {
        status: 'REMINDER_PENDING',
        reminderAt: until,
        reminderSentAt: null,
        reminderLeaseUntil: null,
      },
    });
  }

  public async setStatus(
    id: string,
    status: 'SKIPPED' | 'CANCELLED',
  ): Promise<void> {
    await this.db.journalSession.update({ where: { id }, data: { status } });
  }

  public async confirm(id: string): Promise<JournalSessionRecord> {
    return toRecord(
      await this.db.journalSession.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          confirmationRequired: false,
          syncStatus: 'PENDING',
          syncNextAttemptAt: new Date(),
        },
        include: includeSettings,
      }),
    );
  }

  public async listDueSync(
    now = new Date(),
    limit = 10,
  ): Promise<JournalSessionRecord[]> {
    const rows = await this.db.journalSession.findMany({
      where: {
        status: 'COMPLETED',
        syncStatus: { in: ['PENDING', 'FAILED'] },
        syncNextAttemptAt: { lte: now },
      },
      take: limit,
      orderBy: { syncNextAttemptAt: 'asc' },
      include: includeSettings,
    });
    return rows.map(toRecord);
  }

  public async markSynced(
    id: string,
    page: { pageId: string; pageUrl?: string },
    answers: JournalSections,
  ): Promise<void> {
    await this.db.journalSession.update({
      where: { id },
      data: {
        syncStatus: 'SYNCED',
        syncError: null,
        syncNextAttemptAt: null,
        notionPageId: page.pageId,
        notionPageUrl: page.pageUrl ?? null,
        syncedAnswers: answers,
        transcript: null,
        draft: Prisma.DbNull,
      },
    });
  }

  public async markSyncFailure(
    id: string,
    error: string,
    conflict = false,
    now = new Date(),
  ): Promise<void> {
    const current = await this.db.journalSession.findUniqueOrThrow({
      where: { id },
    });
    const attempts = current.syncAttempts + 1;
    await this.db.journalSession.update({
      where: { id },
      data: {
        syncStatus: conflict ? 'CONFLICT' : 'FAILED',
        syncAttempts: attempts,
        syncError: error.slice(0, 1_000),
        syncNextAttemptAt: conflict
          ? null
          : new Date(
              now.getTime() + Math.min(6 * 60 * 60_000, 60_000 * 2 ** attempts),
            ),
      },
    });
  }
}
