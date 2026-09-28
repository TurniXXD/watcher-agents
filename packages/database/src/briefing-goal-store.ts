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
});

export type BriefingGoalRecord = {
  id: number;
  title: string;
  dueOn: string;
};

const toRecord = (goal: {
  id: number;
  title: string;
  dueOn: Date;
}): BriefingGoalRecord => ({
  id: goal.id,
  title: goal.title,
  dueOn: goal.dueOn.toISOString().slice(0, 10),
});

export class BriefingGoalStore {
  public constructor(private readonly db: DatabaseClient) {}

  public async add(
    telegramChatId: bigint,
    input: z.input<typeof briefingGoalInputSchema>,
  ): Promise<BriefingGoalRecord> {
    const goal = briefingGoalInputSchema.parse(input);
    const created = await this.db.briefingGoal.create({
      data: {
        title: goal.title,
        dueOn: new Date(`${goal.dueOn}T00:00:00.000Z`),
        settings: { connect: { telegramChatId } },
      },
    });
    return toRecord(created);
  }

  public async list(telegramChatId: bigint): Promise<BriefingGoalRecord[]> {
    const rows = await this.db.briefingGoal.findMany({
      where: { settings: { telegramChatId } },
      orderBy: [{ dueOn: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toRecord);
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
