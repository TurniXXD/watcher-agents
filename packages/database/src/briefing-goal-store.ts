import { z } from 'zod';
import type { DatabaseClient } from './client.js';

export const briefingGoalInputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(
      /^[^\p{Cc}\p{Cf}]+$/u,
      'Goal title cannot contain control characters',
    ),
  dueOn: z.iso.date(),
  horizon: z.enum(['LONG_TERM', 'MONTHLY', 'WEEKLY']).default('LONG_TERM'),
  parentGoalId: z.number().int().positive().optional(),
  description: z.string().trim().min(1).max(4_000).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'PRIMARY']).default('NORMAL'),
  startOn: z.iso.date().optional(),
});

export type BriefingGoalRecord = {
  id: number;
  title: string;
  dueOn: string;
  publicId?: string;
  horizon?: 'LONG_TERM' | 'MONTHLY' | 'WEEKLY';
  status?: 'ACTIVE' | 'COMPLETED' | 'ARCHIVED' | 'CANCELLED';
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'PRIMARY';
  progress?: number;
  parentGoalId?: number;
  description?: string;
  startOn?: string;
};

const toRecord = (goal: {
  id: number;
  title: string;
  dueOn: Date;
  publicId: string;
  horizon: NonNullable<BriefingGoalRecord['horizon']>;
  status: NonNullable<BriefingGoalRecord['status']>;
  priority: NonNullable<BriefingGoalRecord['priority']>;
  progress: number;
  parentGoalId: number | null;
  description: string | null;
  startOn: Date | null;
}): BriefingGoalRecord => ({
  id: goal.id,
  title: goal.title,
  dueOn: goal.dueOn.toISOString().slice(0, 10),
  publicId: goal.publicId,
  horizon: goal.horizon,
  status: goal.status,
  priority: goal.priority,
  progress: goal.progress,
  ...(goal.parentGoalId === null ? {} : { parentGoalId: goal.parentGoalId }),
  ...(goal.description ? { description: goal.description } : {}),
  ...(goal.startOn ? { startOn: goal.startOn.toISOString().slice(0, 10) } : {}),
});

export class BriefingGoalStore {
  public constructor(private readonly db: DatabaseClient) {}

  public async add(
    telegramChatId: bigint,
    input: z.input<typeof briefingGoalInputSchema>,
  ): Promise<BriefingGoalRecord> {
    const goal = briefingGoalInputSchema.parse(input);
    if (goal.parentGoalId) {
      const parent = await this.db.briefingGoal.findFirst({
        where: {
          id: goal.parentGoalId,
          settings: { telegramChatId },
          status: 'ACTIVE',
        },
        select: { horizon: true },
      });
      if (!parent) throw new Error('Parent goal does not belong to this chat');
      const rank = { LONG_TERM: 3, MONTHLY: 2, WEEKLY: 1 } as const;
      if (rank[parent.horizon] <= rank[goal.horizon]) {
        throw new Error('Parent goal must have a longer planning horizon');
      }
    }
    const created = await this.db.briefingGoal.create({
      data: {
        title: goal.title,
        dueOn: new Date(`${goal.dueOn}T00:00:00.000Z`),
        horizon: goal.horizon,
        priority: goal.priority,
        ...(goal.parentGoalId
          ? { parentGoal: { connect: { id: goal.parentGoalId } } }
          : {}),
        ...(goal.description ? { description: goal.description } : {}),
        ...(goal.startOn
          ? { startOn: new Date(`${goal.startOn}T00:00:00.000Z`) }
          : {}),
        settings: { connect: { telegramChatId } },
      },
    });
    return toRecord(created);
  }

  public async list(telegramChatId: bigint): Promise<BriefingGoalRecord[]> {
    const rows = await this.db.briefingGoal.findMany({
      where: { settings: { telegramChatId }, status: 'ACTIVE' },
      orderBy: [{ horizon: 'asc' }, { dueOn: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toRecord);
  }

  public async update(
    telegramChatId: bigint,
    id: number,
    change: {
      status?: NonNullable<BriefingGoalRecord['status']>;
      progress?: number;
      priority?: NonNullable<BriefingGoalRecord['priority']>;
      title?: string;
      description?: string | null;
    },
  ): Promise<BriefingGoalRecord | undefined> {
    z.number().int().positive().parse(id);
    if (change.progress !== undefined)
      z.number().int().min(0).max(100).parse(change.progress);
    if (change.title !== undefined)
      briefingGoalInputSchema.shape.title.parse(change.title);
    const owned = await this.db.briefingGoal.findFirst({
      where: { id, settings: { telegramChatId } },
      select: { id: true },
    });
    if (!owned) return undefined;
    return toRecord(
      await this.db.briefingGoal.update({
        where: { id },
        data: { ...change, syncStatus: 'PENDING', syncError: null },
      }),
    );
  }

  public async remove(
    telegramChatId: bigint,
    rawId: unknown,
  ): Promise<boolean> {
    const id = z.number().int().positive().parse(rawId);
    const deleted = await this.db.briefingGoal.deleteMany({
      where: { id, settings: { telegramChatId } },
    });
    return deleted.count > 0;
  }
}
