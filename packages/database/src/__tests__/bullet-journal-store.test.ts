import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient } from '../client.js';
import { BulletJournalStore } from '../bullet-journal-store.js';

describe('BulletJournalStore', () => {
  it('does not duplicate a backlog task when its atomic status claim loses', async () => {
    const createMigration = vi.fn();
    const createTask = vi.fn();
    const transaction = {
      briefingTask: {
        findFirst: vi.fn(async () => ({
          id: '11111111-1111-4111-8111-111111111111',
          settingsId: 1,
          title: 'Odložený úkol',
          description: null,
          planningDate: '2026-10-31',
          status: 'BACKLOG',
          priority: 'NORMAL',
          estimatedMinutes: 30,
          scheduledAt: null,
          deadlineAt: null,
          goalId: null,
          tags: [],
          source: 'PLANNED',
        })),
        updateMany: vi.fn(async () => ({ count: 0 })),
        create: createTask,
      },
      briefingTaskMigration: { create: createMigration },
    };
    const database = {
      $transaction: vi.fn(
        async (callback: (client: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as DatabaseClient;

    await expect(
      new BulletJournalStore(database).migrateTask(
        12n,
        '11111111-1111-4111-8111-111111111111',
        '2026-11-01',
        'RESCHEDULED',
        'BACKLOG',
      ),
    ).resolves.toBeUndefined();

    expect(transaction.briefingTask.updateMany).toHaveBeenCalledWith({
      where: {
        id: '11111111-1111-4111-8111-111111111111',
        status: 'BACKLOG',
        settings: { telegramChatId: 12n },
      },
      data: { status: 'MIGRATED', syncStatus: 'PENDING' },
    });
    expect(createMigration).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
  });
});
