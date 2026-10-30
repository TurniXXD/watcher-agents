import { z } from 'zod';
import type { DatabaseClient } from './client.js';
import { journalReminderInstant } from './journal-session-store.js';
import type { Prisma } from './generated/prisma/client.js';

export const planningDateSchema = z.iso.date();
export const briefingPrioritySchema = z.enum([
  'LOW',
  'NORMAL',
  'HIGH',
  'PRIMARY',
]);
export const briefingTaskStatusSchema = z.enum([
  'TODO',
  'IN_PROGRESS',
  'COMPLETED',
  'MIGRATED',
  'CANCELLED',
  'BACKLOG',
]);
export const planningSessionKindSchema = z.enum([
  'MORNING',
  'DAILY_REVIEW',
  'WEEKLY_REVIEW',
  'MONTHLY_REVIEW',
]);
export const planningSessionStatusSchema = z.enum([
  'PENDING',
  'IN_PROGRESS',
  'AWAITING_CONFIRMATION',
  'COMPLETED',
  'POSTPONED',
  'CANCELLED',
]);

export const briefingTaskInputSchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(4_000).optional(),
  planningDate: planningDateSchema,
  priority: briefingPrioritySchema.default('NORMAL'),
  estimatedMinutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .optional(),
  actualMinutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .optional(),
  scheduledAt: z.date().optional(),
  deadlineAt: z.date().optional(),
  goalId: z.number().int().positive().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  source: z.enum(['PLANNED', 'UNPLANNED']).default('PLANNED'),
});

export type BriefingTaskRecord = {
  id: string;
  telegramChatId: bigint;
  title: string;
  description?: string;
  planningDate: string;
  status: z.infer<typeof briefingTaskStatusSchema>;
  priority: z.infer<typeof briefingPrioritySchema>;
  estimatedMinutes?: number;
  actualMinutes?: number;
  scheduledAt?: Date;
  deadlineAt?: Date;
  goalId?: number;
  goalTitle?: string;
  goalPublicId?: string;
  goalNotionPageId?: string;
  tags: string[];
  source: 'PLANNED' | 'UNPLANNED';
  completedAt?: Date;
  notionPageId?: string;
  notionPageUrl?: string;
  syncStatus: 'NOT_READY' | 'PENDING' | 'SYNCED' | 'FAILED' | 'CONFLICT';
  migrationCount: number;
};

export type PlanningSessionRecord = {
  id: string;
  telegramChatId: bigint;
  telegramUserId: bigint;
  kind: z.infer<typeof planningSessionKindSchema>;
  periodStart: string;
  periodEnd: string;
  status: z.infer<typeof planningSessionStatusSchema>;
  currentStep: number;
  draft: Record<string, unknown>;
  reminderAt?: Date;
  reminderSentAt?: Date;
  followUpSentAt?: Date;
};

export type BriefingReviewRecord = {
  id: string;
  telegramChatId: bigint;
  type: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  periodStart: string;
  periodEnd: string;
  answers: Record<string, string>;
  metrics: Record<string, unknown>;
  summary?: string;
  alignment?: string;
  nextPriorities: string[];
  monthlyPrinciples: string[];
  dailyPractice?: string;
  syncStatus: 'NOT_READY' | 'PENDING' | 'SYNCED' | 'FAILED' | 'CONFLICT';
  notionPageId?: string;
  notionPageUrl?: string;
};

export type PlanningGoalSyncRecord = {
  id: number;
  publicId: string;
  title: string;
  description?: string;
  horizon: 'LONG_TERM' | 'MONTHLY' | 'WEEKLY';
  status: 'ACTIVE' | 'COMPLETED' | 'ARCHIVED' | 'CANCELLED';
  priority: BriefingTaskRecord['priority'];
  progress: number;
  parentPublicId?: string;
  startOn?: string;
  dueOn: string;
  notionPageId?: string;
};

export type PlanningSyncBatch = {
  goals: PlanningGoalSyncRecord[];
  tasks: BriefingTaskRecord[];
  reviews: BriefingReviewRecord[];
};

const includeTask = {
  settings: { select: { telegramChatId: true } },
  goal: { select: { title: true, publicId: true, notionPageId: true } },
  _count: { select: { migrations: true } },
} as const;

const toTask = (row: {
  id: string;
  settings: { telegramChatId: bigint };
  title: string;
  description: string | null;
  planningDate: string;
  status: BriefingTaskRecord['status'];
  priority: BriefingTaskRecord['priority'];
  estimatedMinutes: number | null;
  actualMinutes: number | null;
  scheduledAt: Date | null;
  deadlineAt: Date | null;
  goalId: number | null;
  tags: string[];
  source: BriefingTaskRecord['source'];
  completedAt: Date | null;
  notionPageId: string | null;
  notionPageUrl: string | null;
  syncStatus: BriefingTaskRecord['syncStatus'];
  goal: { title: string; publicId: string; notionPageId: string | null } | null;
  _count: { migrations: number };
}): BriefingTaskRecord => ({
  id: row.id,
  telegramChatId: row.settings.telegramChatId,
  title: row.title,
  ...(row.description ? { description: row.description } : {}),
  planningDate: row.planningDate,
  status: row.status,
  priority: row.priority,
  ...(row.estimatedMinutes === null
    ? {}
    : { estimatedMinutes: row.estimatedMinutes }),
  ...(row.actualMinutes === null ? {} : { actualMinutes: row.actualMinutes }),
  ...(row.scheduledAt ? { scheduledAt: row.scheduledAt } : {}),
  ...(row.deadlineAt ? { deadlineAt: row.deadlineAt } : {}),
  ...(row.goalId === null ? {} : { goalId: row.goalId }),
  ...(row.goal ? { goalTitle: row.goal.title } : {}),
  ...(row.goal ? { goalPublicId: row.goal.publicId } : {}),
  ...(row.goal?.notionPageId
    ? { goalNotionPageId: row.goal.notionPageId }
    : {}),
  tags: row.tags,
  source: row.source,
  ...(row.completedAt ? { completedAt: row.completedAt } : {}),
  ...(row.notionPageId ? { notionPageId: row.notionPageId } : {}),
  ...(row.notionPageUrl ? { notionPageUrl: row.notionPageUrl } : {}),
  syncStatus: row.syncStatus,
  migrationCount: row._count.migrations,
});

const jsonRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const toReview = (row: {
  id: string;
  settings: { telegramChatId: bigint };
  type: BriefingReviewRecord['type'];
  periodStart: string;
  periodEnd: string;
  answers: unknown;
  metrics: unknown;
  summary: string | null;
  alignment: string | null;
  nextPriorities: string[];
  monthlyPrinciples: string[];
  dailyPractice: string | null;
  syncStatus: BriefingReviewRecord['syncStatus'];
  notionPageId: string | null;
  notionPageUrl: string | null;
}): BriefingReviewRecord => ({
  id: row.id,
  telegramChatId: row.settings.telegramChatId,
  type: row.type,
  periodStart: row.periodStart,
  periodEnd: row.periodEnd,
  answers: z.record(z.string(), z.string()).parse(row.answers),
  metrics: jsonRecord(row.metrics),
  ...(row.summary ? { summary: row.summary } : {}),
  ...(row.alignment ? { alignment: row.alignment } : {}),
  nextPriorities: row.nextPriorities,
  monthlyPrinciples: row.monthlyPrinciples,
  ...(row.dailyPractice ? { dailyPractice: row.dailyPractice } : {}),
  syncStatus: row.syncStatus,
  ...(row.notionPageId ? { notionPageId: row.notionPageId } : {}),
  ...(row.notionPageUrl ? { notionPageUrl: row.notionPageUrl } : {}),
});

const includeSession = {
  settings: { select: { telegramChatId: true } },
} as const;

const toSession = (row: {
  id: string;
  telegramUserId: bigint;
  kind: PlanningSessionRecord['kind'];
  periodStart: string;
  periodEnd: string;
  status: PlanningSessionRecord['status'];
  currentStep: number;
  draft: unknown;
  reminderAt: Date | null;
  reminderSentAt: Date | null;
  followUpSentAt: Date | null;
  settings: { telegramChatId: bigint };
}): PlanningSessionRecord => ({
  id: row.id,
  telegramChatId: row.settings.telegramChatId,
  telegramUserId: row.telegramUserId,
  kind: row.kind,
  periodStart: row.periodStart,
  periodEnd: row.periodEnd,
  status: row.status,
  currentStep: row.currentStep,
  draft: jsonRecord(row.draft),
  ...(row.reminderAt ? { reminderAt: row.reminderAt } : {}),
  ...(row.reminderSentAt ? { reminderSentAt: row.reminderSentAt } : {}),
  ...(row.followUpSentAt ? { followUpSentAt: row.followUpSentAt } : {}),
});

const assertOwnedGoal = async (
  db: DatabaseClient,
  telegramChatId: bigint,
  goalId: number | undefined,
): Promise<void> => {
  if (!goalId) return;
  const count = await db.briefingGoal.count({
    where: { id: goalId, settings: { telegramChatId } },
  });
  if (count !== 1) throw new Error('Goal does not belong to this chat');
};

export class BulletJournalStore {
  public constructor(private readonly db: DatabaseClient) {}

  public async createTask(
    telegramChatId: bigint,
    raw: z.input<typeof briefingTaskInputSchema>,
  ): Promise<BriefingTaskRecord> {
    const input = briefingTaskInputSchema.parse(raw);
    await assertOwnedGoal(this.db, telegramChatId, input.goalId);
    return toTask(
      await this.db.briefingTask.create({
        data: {
          title: input.title,
          planningDate: input.planningDate,
          priority: input.priority,
          tags: input.tags,
          source: input.source,
          ...(input.description ? { description: input.description } : {}),
          ...(input.estimatedMinutes
            ? { estimatedMinutes: input.estimatedMinutes }
            : {}),
          ...(input.actualMinutes
            ? { actualMinutes: input.actualMinutes }
            : {}),
          ...(input.scheduledAt ? { scheduledAt: input.scheduledAt } : {}),
          ...(input.deadlineAt ? { deadlineAt: input.deadlineAt } : {}),
          ...(input.goalId ? { goal: { connect: { id: input.goalId } } } : {}),
          settings: { connect: { telegramChatId } },
        },
        include: includeTask,
      }),
    );
  }

  public async commitMorningPlan(
    sessionId: string,
    telegramChatId: bigint,
    tasks: readonly z.input<typeof briefingTaskInputSchema>[],
  ): Promise<BriefingTaskRecord[]> {
    const parsed = tasks.map((task) => briefingTaskInputSchema.parse(task));
    for (const task of parsed)
      await assertOwnedGoal(this.db, telegramChatId, task.goalId);
    return this.db.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`planning-session:${sessionId}`}))`;
      const session = await transaction.planningSession.findFirst({
        where: { id: sessionId, settings: { telegramChatId } },
      });
      if (!session)
        throw new Error('Planning session does not belong to this chat');
      if (session.status !== 'COMPLETED') {
        for (const task of parsed) {
          await transaction.briefingTask.create({
            data: {
              settingsId: session.settingsId,
              planningSessionId: session.id,
              title: task.title,
              planningDate: task.planningDate,
              priority: task.priority,
              tags: task.tags,
              source: task.source,
              ...(task.description ? { description: task.description } : {}),
              ...(task.estimatedMinutes
                ? { estimatedMinutes: task.estimatedMinutes }
                : {}),
              ...(task.actualMinutes
                ? { actualMinutes: task.actualMinutes }
                : {}),
              ...(task.scheduledAt ? { scheduledAt: task.scheduledAt } : {}),
              ...(task.deadlineAt ? { deadlineAt: task.deadlineAt } : {}),
              ...(task.goalId ? { goalId: task.goalId } : {}),
            },
          });
        }
        await transaction.planningSession.update({
          where: { id: sessionId },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
      }
      return (
        await transaction.briefingTask.findMany({
          where: { planningSessionId: sessionId },
          orderBy: { createdAt: 'asc' },
          include: includeTask,
        })
      ).map(toTask);
    });
  }

  public async listTasks(
    telegramChatId: bigint,
    options: {
      fromDate?: string;
      toDate?: string;
      statuses?: BriefingTaskRecord['status'][];
    } = {},
  ): Promise<BriefingTaskRecord[]> {
    if (options.fromDate) planningDateSchema.parse(options.fromDate);
    if (options.toDate) planningDateSchema.parse(options.toDate);
    const rows = await this.db.briefingTask.findMany({
      where: {
        settings: { telegramChatId },
        ...(options.fromDate || options.toDate
          ? {
              planningDate: {
                ...(options.fromDate ? { gte: options.fromDate } : {}),
                ...(options.toDate ? { lte: options.toDate } : {}),
              },
            }
          : {}),
        ...(options.statuses ? { status: { in: options.statuses } } : {}),
      },
      orderBy: [
        { planningDate: 'asc' },
        { priority: 'desc' },
        { createdAt: 'asc' },
      ],
      include: includeTask,
    });
    return rows.map(toTask);
  }

  public async listTasksForSyncDate(
    telegramChatId: bigint,
    planningDate: string,
  ): Promise<BriefingTaskRecord[]> {
    planningDateSchema.parse(planningDate);
    return (
      await this.db.briefingTask.findMany({
        where: { planningDate, settings: { telegramChatId } },
        orderBy: { createdAt: 'asc' },
        include: includeTask,
      })
    ).map(toTask);
  }

  public async resolveTask(
    telegramChatId: bigint,
    reference: string,
    planningDate?: string,
  ): Promise<BriefingTaskRecord[]> {
    const value = z.string().trim().min(1).max(240).parse(reference);
    const rows = await this.db.briefingTask.findMany({
      where: {
        settings: { telegramChatId },
        ...(planningDate ? { planningDate } : {}),
        OR: [
          { id: { startsWith: value } },
          { title: { contains: value, mode: 'insensitive' } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      include: includeTask,
    });
    return rows.map(toTask);
  }

  public async updateTask(
    telegramChatId: bigint,
    id: string,
    change: {
      status?: BriefingTaskRecord['status'];
      priority?: BriefingTaskRecord['priority'];
      estimatedMinutes?: number | null;
      actualMinutes?: number | null;
      planningDate?: string;
      goalId?: number | null;
    },
  ): Promise<BriefingTaskRecord | undefined> {
    if (change.planningDate) planningDateSchema.parse(change.planningDate);
    if (
      change.estimatedMinutes !== undefined &&
      change.estimatedMinutes !== null
    )
      z.number()
        .int()
        .min(1)
        .max(24 * 60)
        .parse(change.estimatedMinutes);
    if (change.actualMinutes !== undefined && change.actualMinutes !== null)
      z.number()
        .int()
        .min(1)
        .max(24 * 60)
        .parse(change.actualMinutes);
    await assertOwnedGoal(this.db, telegramChatId, change.goalId ?? undefined);
    const owned = await this.db.briefingTask.findFirst({
      where: { id, settings: { telegramChatId } },
      select: { id: true },
    });
    if (!owned) return undefined;
    return toTask(
      await this.db.briefingTask.update({
        where: { id },
        data: {
          ...change,
          ...(change.status
            ? {
                completedAt: change.status === 'COMPLETED' ? new Date() : null,
              }
            : {}),
          syncStatus: 'PENDING',
          syncError: null,
        },
        include: includeTask,
      }),
    );
  }

  public async migrateTask(
    telegramChatId: bigint,
    id: string,
    toDate: string | undefined,
    decision: 'MIGRATED' | 'RESCHEDULED' | 'BACKLOG' | 'CANCELLED',
  ): Promise<BriefingTaskRecord | undefined> {
    if (toDate) planningDateSchema.parse(toDate);
    return this.db.$transaction(async (transaction) => {
      const original = await transaction.briefingTask.findFirst({
        where: { id, settings: { telegramChatId } },
      });
      if (!original) return undefined;
      await transaction.briefingTaskMigration.create({
        data: {
          taskId: id,
          fromDate: original.planningDate,
          ...(toDate ? { toDate } : {}),
          decision,
        },
      });
      const terminalStatus =
        decision === 'CANCELLED'
          ? 'CANCELLED'
          : decision === 'BACKLOG'
            ? 'BACKLOG'
            : 'MIGRATED';
      await transaction.briefingTask.update({
        where: { id },
        data: { status: terminalStatus, syncStatus: 'PENDING' },
      });
      if (decision === 'CANCELLED' || decision === 'BACKLOG') {
        return toTask(
          await transaction.briefingTask.findUniqueOrThrow({
            where: { id },
            include: includeTask,
          }),
        );
      }
      const created = await transaction.briefingTask.create({
        data: {
          settingsId: original.settingsId,
          title: original.title,
          description: original.description,
          planningDate: toDate!,
          status: 'TODO',
          priority: original.priority,
          estimatedMinutes: original.estimatedMinutes,
          scheduledAt: original.scheduledAt,
          deadlineAt: original.deadlineAt,
          goalId: original.goalId,
          tags: original.tags,
          source: original.source,
        },
        include: includeTask,
      });
      return toTask(created);
    });
  }

  public async ensureSession(
    telegramChatId: bigint,
    telegramUserId: bigint,
    kind: PlanningSessionRecord['kind'],
    periodStart: string,
    periodEnd = periodStart,
    reminderAt?: Date,
  ): Promise<PlanningSessionRecord> {
    planningDateSchema.parse(periodStart);
    planningDateSchema.parse(periodEnd);
    const settings = await this.db.briefingSettings.upsert({
      where: { telegramChatId },
      create: { telegramChatId },
      update: {},
    });
    return toSession(
      await this.db.planningSession.upsert({
        where: {
          settingsId_telegramUserId_kind_periodStart: {
            settingsId: settings.id,
            telegramUserId,
            kind,
            periodStart,
          },
        },
        create: {
          settingsId: settings.id,
          telegramUserId,
          kind,
          periodStart,
          periodEnd,
          ...(reminderAt ? { reminderAt } : {}),
        },
        update: {},
        include: includeSession,
      }),
    );
  }

  public async initializeScheduledSessions(
    now: Date,
    timezone: string,
    morningTime: string,
    eveningTime: string,
  ): Promise<void> {
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    const settings = await this.db.briefingSettings.findMany({
      where: { onboardingComplete: true },
      select: { id: true, telegramChatId: true },
    });
    const instant = new Date(`${date}T12:00:00.000Z`);
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
    }).format(instant);
    const [year, month, day] = date.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year ?? 0, month ?? 0, 0)).getUTCDate();
    const morningAt = journalReminderInstant(date, morningTime, timezone);
    const eveningAt = journalReminderInstant(date, eveningTime, timezone);
    const weekDay = instant.getUTCDay() || 7;
    const weekStart = new Date(instant);
    weekStart.setUTCDate(weekStart.getUTCDate() - weekDay + 1);
    const periodStart = weekStart.toISOString().slice(0, 10);
    for (const item of settings) {
      const base = {
        settingsId: item.id,
        telegramUserId: item.telegramChatId,
      };
      await this.db.planningSession.createMany({
        data: [
          {
            ...base,
            kind: 'MORNING',
            periodStart: date,
            periodEnd: date,
            reminderAt: morningAt,
          },
          {
            ...base,
            kind: 'DAILY_REVIEW',
            periodStart: date,
            periodEnd: date,
            reminderAt: eveningAt,
          },
          ...(weekday === 'Sun'
            ? [
                {
                  ...base,
                  kind: 'WEEKLY_REVIEW' as const,
                  periodStart,
                  periodEnd: date,
                  reminderAt: new Date(eveningAt.getTime() + 60 * 60_000),
                },
              ]
            : []),
          ...(day === lastDay
            ? [
                {
                  ...base,
                  kind: 'MONTHLY_REVIEW' as const,
                  periodStart: `${year}-${String(month).padStart(2, '0')}-01`,
                  periodEnd: date,
                  reminderAt: new Date(eveningAt.getTime() + 90 * 60_000),
                },
              ]
            : []),
        ],
        skipDuplicates: true,
      });
    }
  }

  public async claimDuePlanningReminders(
    now: Date,
    maximumDelayMs = 6 * 60 * 60_000,
  ): Promise<PlanningSessionRecord[]> {
    const earliest = new Date(now.getTime() - maximumDelayMs);
    const leaseUntil = new Date(now.getTime() + 2 * 60_000);
    return this.db.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('planning-reminder-scheduler'))`;
      const candidates = await transaction.planningSession.findMany({
        where: {
          status: { in: ['PENDING', 'POSTPONED'] },
          reminderAt: { gte: earliest, lte: now },
          reminderSentAt: null,
          OR: [
            { reminderLeaseUntil: null },
            { reminderLeaseUntil: { lt: now } },
          ],
        },
        orderBy: [{ reminderAt: 'asc' }, { kind: 'asc' }],
        take: 25,
        include: includeSession,
      });
      const eligible: typeof candidates = [];
      for (const candidate of candidates) {
        if (
          candidate.kind === 'WEEKLY_REVIEW' ||
          candidate.kind === 'MONTHLY_REVIEW'
        ) {
          const dailyComplete = await transaction.planningSession.count({
            where: {
              settingsId: candidate.settingsId,
              telegramUserId: candidate.telegramUserId,
              kind: 'DAILY_REVIEW',
              periodStart: candidate.periodEnd,
              status: 'COMPLETED',
            },
          });
          const journalComplete = await transaction.journalSession.count({
            where: {
              settingsId: candidate.settingsId,
              telegramUserId: candidate.telegramUserId,
              journalDate: candidate.periodEnd,
              status: { in: ['COMPLETED', 'SKIPPED'] },
            },
          });
          if (!dailyComplete || !journalComplete) continue;
          if (candidate.kind === 'MONTHLY_REVIEW') {
            const weeklyPending = await transaction.planningSession.count({
              where: {
                settingsId: candidate.settingsId,
                telegramUserId: candidate.telegramUserId,
                kind: 'WEEKLY_REVIEW',
                periodEnd: candidate.periodEnd,
                status: { notIn: ['COMPLETED', 'CANCELLED'] },
              },
            });
            if (weeklyPending) continue;
          }
        }
        eligible.push(candidate);
      }
      if (eligible.length) {
        await transaction.planningSession.updateMany({
          where: { id: { in: eligible.map(({ id }) => id) } },
          data: { reminderLeaseUntil: leaseUntil },
        });
      }
      return eligible.map(toSession);
    });
  }

  public async markPlanningReminderSent(
    id: string,
    sentAt: Date,
  ): Promise<void> {
    await this.db.planningSession.update({
      where: { id },
      data: { reminderSentAt: sentAt, reminderLeaseUntil: null },
    });
  }

  public async releasePlanningReminder(id: string): Promise<void> {
    await this.db.planningSession.update({
      where: { id },
      data: { reminderLeaseUntil: null },
    });
  }

  public async claimMorningFollowUps(
    now: Date,
    delayMs: number,
  ): Promise<PlanningSessionRecord[]> {
    const threshold = new Date(now.getTime() - delayMs);
    const rows = await this.db.planningSession.findMany({
      where: {
        kind: 'MORNING',
        status: { in: ['PENDING', 'IN_PROGRESS', 'AWAITING_CONFIRMATION'] },
        reminderSentAt: { lte: threshold },
        followUpSentAt: null,
      },
      take: 25,
      include: includeSession,
    });
    if (rows.length) {
      await this.db.planningSession.updateMany({
        where: {
          id: { in: rows.map(({ id }) => id) },
          followUpSentAt: null,
        },
        data: { followUpSentAt: now },
      });
    }
    return rows.map(toSession);
  }

  public async getActiveSession(
    telegramChatId: bigint,
    telegramUserId: bigint,
  ): Promise<PlanningSessionRecord | undefined> {
    const row = await this.db.planningSession.findFirst({
      where: {
        telegramUserId,
        settings: { telegramChatId },
        status: { in: ['IN_PROGRESS', 'AWAITING_CONFIRMATION', 'POSTPONED'] },
      },
      orderBy: { updatedAt: 'desc' },
      include: includeSession,
    });
    return row ? toSession(row) : undefined;
  }

  public async getSession(
    id: string,
    telegramChatId: bigint,
    telegramUserId: bigint,
  ): Promise<PlanningSessionRecord | undefined> {
    const row = await this.db.planningSession.findFirst({
      where: {
        id,
        telegramUserId,
        settings: { telegramChatId },
      },
      include: includeSession,
    });
    return row ? toSession(row) : undefined;
  }

  public async getSessionForPeriod(
    telegramChatId: bigint,
    telegramUserId: bigint,
    kind: PlanningSessionRecord['kind'],
    periodStart: string,
  ): Promise<PlanningSessionRecord | undefined> {
    planningDateSchema.parse(periodStart);
    const row = await this.db.planningSession.findFirst({
      where: {
        telegramUserId,
        kind,
        periodStart,
        settings: { telegramChatId },
      },
      include: includeSession,
    });
    return row ? toSession(row) : undefined;
  }

  public async updateSession(
    id: string,
    change: {
      status?: PlanningSessionRecord['status'];
      currentStep?: number;
      draft?: Record<string, unknown>;
      reminderSentAt?: Date | null;
      followUpSentAt?: Date | null;
    },
  ): Promise<PlanningSessionRecord> {
    const data: Prisma.PlanningSessionUpdateInput = {
      ...(change.status ? { status: change.status } : {}),
      ...(change.currentStep === undefined
        ? {}
        : { currentStep: change.currentStep }),
      ...(change.draft ? { draft: change.draft as Prisma.InputJsonValue } : {}),
      ...(change.reminderSentAt === undefined
        ? {}
        : { reminderSentAt: change.reminderSentAt }),
      ...(change.followUpSentAt === undefined
        ? {}
        : { followUpSentAt: change.followUpSentAt }),
      ...(change.status === 'COMPLETED' ? { completedAt: new Date() } : {}),
    };
    return toSession(
      await this.db.planningSession.update({
        where: { id },
        data,
        include: includeSession,
      }),
    );
  }

  public async saveReview(
    telegramChatId: bigint,
    input: {
      type: BriefingReviewRecord['type'];
      periodStart: string;
      periodEnd: string;
      answers: Record<string, string>;
      metrics: Record<string, unknown>;
      summary?: string;
      alignment?: string;
      nextPriorities?: string[];
      monthlyPrinciples?: string[];
      dailyPractice?: string;
    },
  ): Promise<BriefingReviewRecord> {
    planningDateSchema.parse(input.periodStart);
    planningDateSchema.parse(input.periodEnd);
    const settings = await this.db.briefingSettings.upsert({
      where: { telegramChatId },
      create: { telegramChatId },
      update: {},
    });
    const row = await this.db.briefingReview.upsert({
      where: {
        settingsId_type_periodStart_periodEnd: {
          settingsId: settings.id,
          type: input.type,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
        },
      },
      create: {
        settingsId: settings.id,
        type: input.type,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        answers: input.answers,
        metrics: input.metrics as Prisma.InputJsonValue,
        ...(input.summary ? { summary: input.summary } : {}),
        ...(input.alignment ? { alignment: input.alignment } : {}),
        nextPriorities: input.nextPriorities ?? [],
        monthlyPrinciples: input.monthlyPrinciples ?? [],
        ...(input.dailyPractice ? { dailyPractice: input.dailyPractice } : {}),
        completedAt: new Date(),
      },
      update: {
        answers: input.answers,
        metrics: input.metrics as Prisma.InputJsonValue,
        ...(input.summary === undefined ? {} : { summary: input.summary }),
        ...(input.alignment === undefined
          ? {}
          : { alignment: input.alignment }),
        nextPriorities: input.nextPriorities ?? [],
        monthlyPrinciples: input.monthlyPrinciples ?? [],
        ...(input.dailyPractice === undefined
          ? {}
          : { dailyPractice: input.dailyPractice }),
        completedAt: new Date(),
        syncStatus: 'PENDING',
        syncError: null,
      },
      include: { settings: { select: { telegramChatId: true } } },
    });
    return toReview(row);
  }

  public async latestCompletedReviews(telegramChatId: bigint): Promise<{
    monthly?: BriefingReviewRecord;
    weekly?: BriefingReviewRecord;
  }> {
    const rows = await this.db.briefingReview.findMany({
      where: {
        settings: { telegramChatId },
        type: { in: ['MONTHLY', 'WEEKLY'] },
        completedAt: { not: null },
      },
      orderBy: { completedAt: 'desc' },
      take: 20,
      include: { settings: { select: { telegramChatId: true } } },
    });
    const monthly = rows.find(({ type }) => type === 'MONTHLY');
    const weekly = rows.find(({ type }) => type === 'WEEKLY');
    return {
      ...(monthly ? { monthly: toReview(monthly) } : {}),
      ...(weekly ? { weekly: toReview(weekly) } : {}),
    };
  }

  public async getReview(
    telegramChatId: bigint,
    type: BriefingReviewRecord['type'],
    periodStart: string,
    periodEnd = periodStart,
  ): Promise<BriefingReviewRecord | undefined> {
    planningDateSchema.parse(periodStart);
    planningDateSchema.parse(periodEnd);
    const row = await this.db.briefingReview.findFirst({
      where: {
        type,
        periodStart,
        periodEnd,
        settings: { telegramChatId },
      },
      include: { settings: { select: { telegramChatId: true } } },
    });
    return row ? toReview(row) : undefined;
  }

  public async listDuePlanningSync(
    now = new Date(),
    limit = 20,
  ): Promise<PlanningSyncBatch> {
    const [goalRows, taskRows, reviewRows] = await Promise.all([
      this.db.briefingGoal.findMany({
        where: {
          syncStatus: { in: ['PENDING', 'FAILED'] },
          OR: [
            { syncNextAttemptAt: null },
            { syncNextAttemptAt: { lte: now } },
          ],
        },
        take: limit,
        orderBy: { updatedAt: 'asc' },
        include: { parentGoal: { select: { publicId: true } } },
      }),
      this.db.briefingTask.findMany({
        where: {
          syncStatus: { in: ['PENDING', 'FAILED'] },
          OR: [
            { syncNextAttemptAt: null },
            { syncNextAttemptAt: { lte: now } },
          ],
        },
        take: limit,
        orderBy: { updatedAt: 'asc' },
        include: includeTask,
      }),
      this.db.briefingReview.findMany({
        where: {
          syncStatus: { in: ['PENDING', 'FAILED'] },
          OR: [
            { syncNextAttemptAt: null },
            { syncNextAttemptAt: { lte: now } },
          ],
        },
        take: limit,
        orderBy: { updatedAt: 'asc' },
        include: { settings: { select: { telegramChatId: true } } },
      }),
    ]);
    return {
      goals: goalRows.map((row) => ({
        id: row.id,
        publicId: row.publicId,
        title: row.title,
        ...(row.description ? { description: row.description } : {}),
        horizon: row.horizon,
        status: row.status,
        priority: row.priority,
        progress: row.progress,
        ...(row.parentGoal ? { parentPublicId: row.parentGoal.publicId } : {}),
        ...(row.startOn
          ? { startOn: row.startOn.toISOString().slice(0, 10) }
          : {}),
        dueOn: row.dueOn.toISOString().slice(0, 10),
        ...(row.notionPageId ? { notionPageId: row.notionPageId } : {}),
      })),
      tasks: taskRows.map(toTask),
      reviews: reviewRows.map(toReview),
    };
  }

  public async markPlanningSynced(
    kind: 'goal' | 'task' | 'review',
    id: number | string,
    page: { pageId: string; pageUrl?: string },
  ): Promise<void> {
    const data = {
      syncStatus: 'SYNCED' as const,
      syncError: null,
      syncNextAttemptAt: null,
      notionPageId: page.pageId,
      notionPageUrl: page.pageUrl ?? null,
    };
    if (kind === 'goal') {
      await this.db.briefingGoal.update({
        where: { id: z.number().int().parse(id) },
        data,
      });
    } else if (kind === 'task') {
      await this.db.briefingTask.update({ where: { id: String(id) }, data });
    } else {
      await this.db.briefingReview.update({ where: { id: String(id) }, data });
    }
  }

  public async markPlanningSyncFailure(
    kind: 'goal' | 'task' | 'review',
    id: number | string,
    error: string,
    now = new Date(),
  ): Promise<void> {
    const current =
      kind === 'goal'
        ? await this.db.briefingGoal.findUniqueOrThrow({
            where: { id: z.coerce.number().int().parse(id) },
            select: { syncAttempts: true },
          })
        : kind === 'task'
          ? await this.db.briefingTask.findUniqueOrThrow({
              where: { id: String(id) },
              select: { syncAttempts: true },
            })
          : await this.db.briefingReview.findUniqueOrThrow({
              where: { id: String(id) },
              select: { syncAttempts: true },
            });
    const attempts = current.syncAttempts + 1;
    const data = {
      syncStatus: 'FAILED' as const,
      syncAttempts: attempts,
      syncError: error.slice(0, 1_000),
      syncNextAttemptAt: new Date(
        now.getTime() + Math.min(6 * 60 * 60_000, 60_000 * 2 ** attempts),
      ),
    };
    if (kind === 'goal') {
      await this.db.briefingGoal.update({
        where: { id: z.coerce.number().int().parse(id) },
        data,
      });
    } else if (kind === 'task') {
      await this.db.briefingTask.update({ where: { id: String(id) }, data });
    } else {
      await this.db.briefingReview.update({ where: { id: String(id) }, data });
    }
  }
}
