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
        where: { settings: { telegramChatId: 123n } },
      }),
    );
    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: 5, settings: { telegramChatId: 123n } },
    });
  });
});
