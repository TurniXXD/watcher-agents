import { describe, expect, it, vi } from 'vitest';
import { BriefingGoalStore } from '../briefing-goal-store.js';
import type { DatabaseClient } from '../client.js';

describe('BriefingGoalStore', () => {
  it('validates calendar dates and goal titles before writing', async () => {
    const create = vi.fn();
    const store = new BriefingGoalStore({
      briefingGoal: { create },
    } as unknown as DatabaseClient);

    await expect(
      store.add(123n, { title: ' ', dueOn: '2026-09-28' }),
    ).rejects.toThrow();
    await expect(
      store.add(123n, { title: 'Finish', dueOn: '2026-02-30' }),
    ).rejects.toThrow();
    await expect(
      store.add(123n, { title: 'Finish\nFake goal', dueOn: '2026-09-28' }),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it('scopes list and removal to the Telegram chat', async () => {
    const findMany = vi.fn(async () => [
      { id: 5, title: 'Finish', dueOn: new Date('2026-09-28T00:00:00Z') },
    ]);
    const deleteMany = vi.fn(async () => ({ count: 1 }));
    const store = new BriefingGoalStore({
      briefingGoal: { findMany, deleteMany },
    } as unknown as DatabaseClient);

    expect(await store.list(123n)).toEqual([
      { id: 5, title: 'Finish', dueOn: '2026-09-28' },
    ]);
    expect(await store.remove(123n, 5)).toBe(true);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          settings: { telegramChatId: 123n },
          status: 'ACTIVE',
        },
      }),
    );
    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: 5, settings: { telegramChatId: 123n } },
    });
  });

  it('requires a parent with a longer horizon in the same chat', async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ horizon: 'LONG_TERM' })
      .mockResolvedValueOnce({ horizon: 'WEEKLY' });
    const create = vi.fn(
      async ({
        data,
      }: {
        data: {
          title: string;
          horizon: 'LONG_TERM' | 'MONTHLY' | 'WEEKLY';
          priority: 'LOW' | 'NORMAL' | 'HIGH' | 'PRIMARY';
          dueOn: Date;
        };
      }) => ({
        id: 6,
        publicId: 'goal-6',
        title: data.title,
        description: null,
        horizon: data.horizon,
        status: 'ACTIVE',
        priority: data.priority,
        progress: 0,
        parentGoalId: 5,
        startOn: null,
        dueOn: data.dueOn,
      }),
    );
    const store = new BriefingGoalStore({
      briefingGoal: { findFirst, create },
    } as unknown as DatabaseClient);

    await expect(
      store.add(123n, {
        title: 'November outcome',
        dueOn: '2026-11-30',
        horizon: 'MONTHLY',
        parentGoalId: 5,
      }),
    ).resolves.toMatchObject({ horizon: 'MONTHLY', parentGoalId: 5 });
    await expect(
      store.add(123n, {
        title: 'Invalid monthly parent',
        dueOn: '2026-11-30',
        horizon: 'MONTHLY',
        parentGoalId: 8,
      }),
    ).rejects.toThrow('longer planning horizon');
  });
});
