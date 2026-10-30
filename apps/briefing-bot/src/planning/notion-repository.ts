import type {
  BriefingReviewRecord,
  BriefingTaskRecord,
  PlanningGoalSyncRecord,
} from '@watcher/database';
import { z } from 'zod';
import type { NotionClient } from '../notion-client.js';

const pageSchema = z
  .object({ id: z.string().min(1), url: z.string().optional() })
  .catchall(z.unknown());

const text = (content: string): Record<string, unknown>[] =>
  content
    .slice(0, 2_000)
    .match(/[\s\S]{1,2000}/gu)
    ?.map((part) => ({ type: 'text', text: { content: part } })) ?? [];

const title = (content: string): Record<string, unknown> => ({
  title: text(content),
});
const richText = (content: string): Record<string, unknown> => ({
  rich_text: text(content),
});
const select = (name: string): Record<string, unknown> => ({
  select: { name },
});
const date = (start: string | undefined): Record<string, unknown> => ({
  date: start ? { start } : null,
});

type PlanningNotionOptions = {
  client: Pick<NotionClient, 'queryDataSource' | 'createPage' | 'updatePage'>;
  goalsDataSourceId: string;
  tasksDataSourceId: string;
  reviewsDataSourceId: string;
  journalDataSourceId?: string;
};

export type SyncedNotionPage = { pageId: string; pageUrl?: string };

export class PlanningNotionRepository {
  public constructor(private readonly options: PlanningNotionOptions) {}

  public async saveGoal(
    goal: PlanningGoalSyncRecord,
    signal?: AbortSignal,
  ): Promise<SyncedNotionPage> {
    const parentPageId = goal.parentPublicId
      ? await this.findPageId(
          this.options.goalsDataSourceId,
          goal.parentPublicId,
          signal,
        )
      : undefined;
    return this.upsert(
      this.options.goalsDataSourceId,
      goal.publicId,
      goal.notionPageId,
      {
        Name: title(goal.title),
        'Stable ID': richText(goal.publicId),
        Horizon: select(goal.horizon),
        Status: select(goal.status),
        Priority: select(goal.priority),
        Progress: { number: goal.progress },
        'Start date': date(goal.startOn),
        'Target date': date(goal.dueOn),
        Description: richText(goal.description ?? ''),
        'Parent goal': { relation: parentPageId ? [{ id: parentPageId }] : [] },
      },
      signal,
    );
  }

  public async saveTask(
    task: BriefingTaskRecord,
    signal?: AbortSignal,
  ): Promise<SyncedNotionPage> {
    const linkedGoalPageId =
      task.goalNotionPageId ??
      (task.goalPublicId
        ? await this.findPageId(
            this.options.goalsDataSourceId,
            task.goalPublicId,
            signal,
          )
        : undefined);
    return this.upsert(
      this.options.tasksDataSourceId,
      task.id,
      task.notionPageId,
      {
        Task: title(task.title),
        'Stable ID': richText(task.id),
        Status: select(task.status),
        Date: date(task.planningDate),
        Priority: select(task.priority),
        'Estimated minutes': { number: task.estimatedMinutes ?? null },
        'Actual minutes': { number: task.actualMinutes ?? null },
        'Scheduled time': date(task.scheduledAt?.toISOString()),
        Deadline: date(task.deadlineAt?.toISOString()),
        'Linked goal': {
          relation: linkedGoalPageId ? [{ id: linkedGoalPageId }] : [],
        },
        'Goal stable ID': richText(task.goalPublicId ?? ''),
        Tags: { multi_select: task.tags.map((name) => ({ name })) },
        Source: select(task.source),
        'Completed at': date(task.completedAt?.toISOString()),
        'Migration count': { number: task.migrationCount },
      },
      signal,
    );
  }

  public async saveReview(
    review: BriefingReviewRecord,
    signal?: AbortSignal,
  ): Promise<SyncedNotionPage> {
    const answerValues = Object.values(review.answers).filter(Boolean);
    return this.upsert(
      this.options.reviewsDataSourceId,
      review.id,
      review.notionPageId,
      {
        Review: title(
          `${review.type} ${review.periodStart}–${review.periodEnd}`,
        ),
        'Stable ID': richText(review.id),
        Type: select(review.type),
        'Period start': date(review.periodStart),
        'Period end': date(review.periodEnd),
        Summary: richText(review.summary ?? ''),
        Accomplishments: richText(answerValues[0] ?? ''),
        Challenges: richText(answerValues[1] ?? ''),
        'Goal alignment': richText(review.alignment ?? ''),
        'Next-period priorities': richText(review.nextPriorities.join('\n')),
        'Monthly principles': richText(review.monthlyPrinciples.join('\n')),
        'Daily practice': richText(review.dailyPractice ?? ''),
        Metrics: richText(JSON.stringify(review.metrics)),
      },
      signal,
    );
  }

  public async updateDailyJournal(
    dateValue: string,
    tasks: readonly BriefingTaskRecord[],
    review?: BriefingReviewRecord,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!this.options.journalDataSourceId) return;
    const response = await this.options.client.queryDataSource(
      this.options.journalDataSourceId,
      {
        filter: { property: 'Date', date: { equals: dateValue } },
        page_size: 2,
      },
      signal,
    );
    if (response.results.length !== 1) return;
    const page = pageSchema.parse(response.results[0]);
    const priorities = tasks
      .filter(({ priority }) => priority === 'PRIMARY')
      .map(({ title: taskTitle }) => taskTitle);
    const properties: Record<string, unknown> = {
      'Morning intentions': richText(
        tasks.map(({ title: taskTitle }) => taskTitle).join('\n'),
      ),
      'Daily priorities': richText(priorities.join('\n')),
      'Planned task IDs': richText(tasks.map(({ id }) => id).join('\n')),
      ...(review
        ? {
            'Evening goal review': richText(review.summary ?? ''),
            'Daily alignment analysis': richText(review.alignment ?? ''),
          }
        : {}),
    };
    await this.options.client.updatePage(
      page.id,
      {
        properties,
      },
      signal,
    );
  }

  private async upsert(
    dataSourceId: string,
    stableId: string,
    knownPageId: string | undefined,
    properties: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<SyncedNotionPage> {
    const pageId =
      knownPageId ?? (await this.findPageId(dataSourceId, stableId, signal));
    const raw = pageId
      ? await this.options.client.updatePage(pageId, { properties }, signal)
      : await this.options.client.createPage(
          {
            parent: { type: 'data_source_id', data_source_id: dataSourceId },
            properties,
          },
          signal,
        );
    const page = pageSchema.parse(raw);
    return {
      pageId: page.id,
      ...(page.url ? { pageUrl: page.url } : {}),
    };
  }

  private async findPageId(
    dataSourceId: string,
    stableId: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    const response = await this.options.client.queryDataSource(
      dataSourceId,
      {
        filter: {
          property: 'Stable ID',
          rich_text: { equals: stableId },
        },
        page_size: 2,
      },
      signal,
    );
    if (response.results.length > 1) {
      throw new Error(`Duplicate Notion page for stable ID ${stableId}`);
    }
    const candidate = response.results[0];
    return candidate ? pageSchema.parse(candidate).id : undefined;
  }
}
