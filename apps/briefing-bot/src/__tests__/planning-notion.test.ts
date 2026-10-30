import type {
  BriefingReviewRecord,
  BriefingTaskRecord,
} from '@watcher/database';
import { describe, expect, it, vi } from 'vitest';
import { PlanningNotionRepository } from '../planning/notion-repository.js';

const task = (): BriefingTaskRecord => ({
  id: 'task-1',
  telegramChatId: 123n,
  title: 'Apply Carnegie principle',
  planningDate: '2026-11-02',
  status: 'TODO',
  priority: 'PRIMARY',
  estimatedMinutes: 30,
  goalPublicId: 'goal-1',
  goalTitle: 'Relationships',
  tags: ['practice'],
  source: 'PLANNED',
  syncStatus: 'PENDING',
  migrationCount: 0,
});

describe('planning Notion projection', () => {
  it('deduplicates by stable ID and resolves a linked goal relation', async () => {
    const queryDataSource = vi
      .fn()
      .mockResolvedValueOnce({
        results: [{ id: 'goal-page' }],
        has_more: false,
        next_cursor: null,
      })
      .mockResolvedValueOnce({
        results: [],
        has_more: false,
        next_cursor: null,
      });
    const createPage = vi.fn(async (input: unknown) => {
      expect(input).toBeDefined();
      return {
        id: 'task-page',
        url: 'https://notion.test/task-page',
      };
    });
    const repository = new PlanningNotionRepository({
      client: {
        queryDataSource,
        createPage,
        updatePage: vi.fn(),
      },
      goalsDataSourceId: 'goals-source',
      tasksDataSourceId: 'tasks-source',
      reviewsDataSourceId: 'reviews-source',
    });

    await expect(repository.saveTask(task())).resolves.toEqual({
      pageId: 'task-page',
      pageUrl: 'https://notion.test/task-page',
    });
    const created = createPage.mock.calls[0]?.[0] as {
      properties: Record<string, unknown>;
    };
    expect(created.properties['Stable ID']).toBeDefined();
    expect(created.properties['Linked goal']).toEqual({
      relation: [{ id: 'goal-page' }],
    });
  });

  it('projects monthly principles and the weekly daily practice separately', async () => {
    const updatePage = vi.fn(
      async (_id: string, input: { properties: Record<string, unknown> }) => ({
        id: 'review-page',
        input,
      }),
    );
    const repository = new PlanningNotionRepository({
      client: {
        queryDataSource: vi.fn().mockResolvedValue({
          results: [{ id: 'review-page' }],
          has_more: false,
          next_cursor: null,
        }),
        createPage: vi.fn(),
        updatePage,
      },
      goalsDataSourceId: 'goals-source',
      tasksDataSourceId: 'tasks-source',
      reviewsDataSourceId: 'reviews-source',
    });
    const review: BriefingReviewRecord = {
      id: 'review-1',
      telegramChatId: 123n,
      type: 'MONTHLY',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      answers: {},
      metrics: {},
      nextPriorities: [],
      monthlyPrinciples: ['Žijeme teď, ne pořád v budoucnosti.'],
      dailyPractice: 'Dostat lidi několikrát za sebou k ano.',
      notionPageId: 'review-page',
      syncStatus: 'PENDING',
    };

    await repository.saveReview(review);

    const updatedReview = updatePage.mock.calls[0]?.[1];
    expect(updatedReview?.properties['Monthly principles']).toBeDefined();
    expect(updatedReview?.properties['Daily practice']).toBeDefined();
  });

  it('does not erase an evening review when only tasks are resynchronized', async () => {
    const updatePage = vi.fn(
      async (_id: string, input: { properties: Record<string, unknown> }) => ({
        id: 'journal-page',
        input,
      }),
    );
    const repository = new PlanningNotionRepository({
      client: {
        queryDataSource: vi.fn().mockResolvedValue({
          results: [{ id: 'journal-page' }],
          has_more: false,
          next_cursor: null,
        }),
        createPage: vi.fn(),
        updatePage,
      },
      goalsDataSourceId: 'goals-source',
      tasksDataSourceId: 'tasks-source',
      reviewsDataSourceId: 'reviews-source',
      journalDataSourceId: 'journal-source',
    });

    await repository.updateDailyJournal('2026-11-02', [task()]);

    const properties = updatePage.mock.calls[0]?.[1].properties;
    expect(properties).toHaveProperty('Morning intentions');
    expect(properties).not.toHaveProperty('Evening goal review');
    expect(properties).not.toHaveProperty('Daily alignment analysis');
  });
});
