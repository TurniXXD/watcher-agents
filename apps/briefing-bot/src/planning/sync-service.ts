import type { BulletJournalStore, PlanningSyncBatch } from '@watcher/database';
import type { WatcherLogger } from '@watcher/core';
import type { PlanningNotionRepository } from './notion-repository.js';

export class PlanningSyncService {
  public constructor(
    private readonly store: BulletJournalStore,
    private readonly repository: PlanningNotionRepository,
    private readonly logger?: WatcherLogger,
  ) {}

  public async synchronizePending(now = new Date()): Promise<void> {
    const batch = await this.store.listDuePlanningSync(now);
    await this.syncBatch(batch, now);
  }

  public async syncBatch(
    batch: PlanningSyncBatch,
    now = new Date(),
  ): Promise<void> {
    const goalOrder = { LONG_TERM: 0, MONTHLY: 1, WEEKLY: 2 } as const;
    const orderedGoals = [...batch.goals].sort(
      (left, right) => goalOrder[left.horizon] - goalOrder[right.horizon],
    );
    for (const goal of orderedGoals) {
      try {
        const page = await this.repository.saveGoal(
          goal,
          AbortSignal.timeout(30_000),
        );
        await this.store.markPlanningSynced('goal', goal.id, page);
      } catch (error) {
        await this.fail('goal', goal.id, error, now);
      }
    }
    for (const task of batch.tasks) {
      try {
        const page = await this.repository.saveTask(
          task,
          AbortSignal.timeout(30_000),
        );
        await this.store.markPlanningSynced('task', task.id, page);
      } catch (error) {
        await this.fail('task', task.id, error, now);
      }
    }
    for (const review of batch.reviews) {
      try {
        const page = await this.repository.saveReview(
          review,
          AbortSignal.timeout(30_000),
        );
        await this.store.markPlanningSynced('review', review.id, page);
      } catch (error) {
        await this.fail('review', review.id, error, now);
      }
    }
    const dates = new Set([
      ...batch.tasks.map(
        ({ telegramChatId, planningDate }) =>
          `${telegramChatId.toString()}:${planningDate}`,
      ),
      ...batch.reviews
        .filter(({ type }) => type === 'DAILY')
        .map(
          ({ telegramChatId, periodStart }) =>
            `${telegramChatId.toString()}:${periodStart}`,
        ),
    ]);
    for (const key of dates) {
      const separator = key.indexOf(':');
      const telegramChatId = BigInt(key.slice(0, separator));
      const date = key.slice(separator + 1);
      try {
        const tasks = await this.store.listTasksForSyncDate(
          telegramChatId,
          date,
        );
        const review = batch.reviews.find(
          (candidate) =>
            candidate.telegramChatId === telegramChatId &&
            candidate.type === 'DAILY' &&
            candidate.periodStart === date,
        );
        await this.repository.updateDailyJournal(date, tasks, review);
      } catch (error) {
        this.logger?.warn(
          { err: error, date },
          'Daily Journal planning projection failed; local records remain authoritative',
        );
      }
    }
  }

  private async fail(
    kind: 'goal' | 'task' | 'review',
    id: number | string,
    error: unknown,
    now: Date,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.store.markPlanningSyncFailure(kind, id, message, now);
    this.logger?.warn({ err: error, kind, id }, 'Planning Notion sync failed');
  }
}
