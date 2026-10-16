import { errorMessage } from '@watcher/core';
import type { SocialsStore } from '@watcher/database';
import { assessNovelty } from './novelty.js';
import type { LightweightIdeaClassifier } from './classifier.js';
import { buildWeeklyPlan, type PlanningAnswers } from './planner.js';
import { buildChatGptPrompt, buildSundayContentPack } from './prompts.js';
import type { SocialNotionSync } from './notion.js';
import { nextPlanningWeek } from './time.js';

export class SocialsService {
  public constructor(
    private readonly options: {
      store: SocialsStore;
      classifier: LightweightIdeaClassifier;
      timezone: string;
      notion?: SocialNotionSync;
      logger?: {
        warn(data: unknown, message: string): void;
      };
    },
  ) {}

  public async captureIdea(
    ownerUserId: bigint,
    chatId: bigint,
    note: string,
    sourceType = 'TELEGRAM',
  ) {
    await this.options.store.ensureSettings(ownerUserId, chatId);
    const [topics, projects, candidates] = await Promise.all([
      this.options.store.listTopics(ownerUserId),
      this.options.store.listProjects(ownerUserId),
      this.options.store.listIdeaCandidates(ownerUserId),
    ]);
    const classification = await this.options.classifier.classify(
      note,
      topics,
      projects,
    );
    const novelty = assessNovelty(
      {
        title: classification.title,
        description: note,
        topicIds: classification.topicIds,
        projectIds: classification.projectIds,
      },
      candidates,
    );
    if (novelty.exactDuplicate) {
      return {
        created: false as const,
        idea: novelty.exactDuplicate,
        novelty,
        classification,
      };
    }
    const idea = await this.options.store.createIdea({
      ownerUserId,
      title: classification.title,
      description: note,
      sourceType,
      topicIds: classification.topicIds,
      projectIds: classification.projectIds,
    });
    return { created: true as const, idea, novelty, classification };
  }

  public async planWeek(input: {
    ownerUserId: bigint;
    chatId: bigint;
    answers: PlanningAnswers;
    planningSessionId?: string;
    now?: Date;
  }) {
    await this.options.store.ensureSettings(input.ownerUserId, input.chatId);
    const week = nextPlanningWeek(
      input.now ?? new Date(),
      this.options.timezone,
    );
    const existing = await this.options.store.findWeeklyPlan(
      input.ownerUserId,
      week.start,
    );
    if (existing) return existing;
    const seed = [
      input.answers.workedOn,
      input.answers.discovered,
      input.answers.problem,
    ]
      .filter(Boolean)
      .join(' — ');
    if (seed) {
      await this.captureIdea(
        input.ownerUserId,
        input.chatId,
        seed,
        'PLANNING_SESSION',
      );
    }
    const [ideas, existingContent] = await Promise.all([
      this.options.store.listIdeaCandidates(input.ownerUserId),
      this.options.store.listContent(input.ownerUserId, { limit: 300 }),
    ]);
    const items = buildWeeklyPlan({
      ideas,
      existingContent,
      answers: input.answers,
      week,
      timezone: this.options.timezone,
    });
    const plan = await this.options.store.createWeeklyPlan({
      ownerUserId: input.ownerUserId,
      weekStart: week.start,
      weekEnd: week.end,
      ...(input.planningSessionId
        ? { planningSessionId: input.planningSessionId }
        : {}),
      items,
    });
    for (const item of plan.contentItems) {
      await this.options.store.updateContentPrompt(
        input.ownerUserId,
        item.id,
        buildChatGptPrompt(item),
      );
    }
    return (
      (await this.options.store.findWeeklyPlan(
        input.ownerUserId,
        week.start,
      )) ?? plan
    );
  }

  public async contentPack(ownerUserId: bigint, now = new Date()) {
    const week = nextPlanningWeek(now, this.options.timezone);
    const plan = await this.options.store.findWeeklyPlan(
      ownerUserId,
      week.start,
    );
    if (!plan) return null;
    const markdown = buildSundayContentPack({
      weekLabel: week.key,
      planId: plan.id,
      items: plan.contentItems,
    });
    const pack = await this.options.store.savePack(plan.id, markdown);
    return { plan, pack };
  }

  public async refreshPrompt(ownerUserId: bigint, contentItemId: string) {
    const item = await this.options.store.contentHistory(
      ownerUserId,
      contentItemId,
    );
    if (!item) throw new Error('Content item not found');
    if (item.weeklyPlan?.status !== 'DRAFT') {
      throw new Error('Only draft plan prompts can be refreshed');
    }
    const prompt = buildChatGptPrompt(item);
    await this.options.store.updateContentPrompt(
      ownerUserId,
      contentItemId,
      prompt,
    );
    return prompt;
  }

  public async synchronizeNotion(ownerUserId: bigint) {
    if (!this.options.notion) return null;
    try {
      return await this.options.notion.synchronize(ownerUserId);
    } catch (error) {
      this.options.logger?.warn(
        { err: errorMessage(error), ownerUserId: ownerUserId.toString() },
        'Socials Notion synchronization failed',
      );
      return { synced: 0, conflicts: 0, failed: 1 };
    }
  }

  public async analytics(ownerUserId: bigint) {
    const content = await this.options.store.listContent(ownerUserId, {
      statuses: ['PUBLISHED'],
      limit: 500,
    });
    const byTopic = new Map<
      string,
      { published: number; engagement: number; leads: number }
    >();
    for (const item of content) {
      const metric = item.metrics[0];
      const engagement =
        (metric?.likes ?? 0) +
        (metric?.comments ?? 0) +
        (metric?.shares ?? 0) +
        (metric?.saves ?? 0);
      for (const { topic } of item.topics) {
        const current = byTopic.get(topic.name) ?? {
          published: 0,
          engagement: 0,
          leads: 0,
        };
        current.published += 1;
        current.engagement += engagement;
        current.leads += metric?.qualifiedLeads ?? 0;
        byTopic.set(topic.name, current);
      }
    }
    return {
      published: content.length,
      topics: [...byTopic.entries()].sort(
        (left, right) =>
          right[1].leads - left[1].leads ||
          right[1].engagement - left[1].engagement,
      ),
      caveat:
        'Přehled ukazuje souvislost zaznamenaných metrik s obsahem, nikoli prokázanou příčinnou souvislost.',
    };
  }
}
