import {
  isNewsCategoryEnabled,
  newsCategorySchema,
  registeredWatcherBots,
  type BriefingEventRepository,
  type NewsCategoryPreference,
  type WatcherBotId,
} from '@watcher/core';
import type {
  BriefingStoryClusterStore,
  BriefingStoryStateRecord,
  BriefingStoryStore,
} from '@watcher/database';
import { clusterBriefingEvents } from './story-clustering.js';
import { rankStories } from './story-ranking.js';
import type { BriefingStoryCluster, StoryEngineResult } from './story-types.js';
import type { SemanticStoryMatcher } from './semantic-story-matcher.js';
import type { WatcherLogger } from '@watcher/core';

type StoryStates = Pick<BriefingStoryStore, 'list'>;
type ClusterPersistence = Pick<
  BriefingStoryClusterStore,
  'findIdByEventIds' | 'save'
>;
type NewsCategoryPreferences = {
  categoryPreferencesForTelegramChat(
    telegramChatId: bigint,
  ): Promise<NewsCategoryPreference[]>;
};

const MAX_CANDIDATE_EVENTS = 1_000;

export type StoryEngineInput = {
  telegramChatId: bigint;
  subscriptions: readonly WatcherBotId[];
  periodStart: Date;
  periodEnd: Date;
  priorityKeywords?: readonly string[];
  mutedKeywords?: readonly string[];
  includePreviouslyMentioned?: boolean;
};

const comparableSummary = (value: string): string =>
  value.toLowerCase().replace(/\s+/g, ' ').trim();

const applyContinuity = (
  cluster: BriefingStoryCluster,
  previous: BriefingStoryStateRecord | undefined,
): BriefingStoryCluster => ({
  ...cluster,
  ...(previous ? { previousSummary: previous.lastSummary } : {}),
  previouslyMentioned: Boolean(previous),
});

const shouldSuppress = (
  cluster: BriefingStoryCluster,
  previous: BriefingStoryStateRecord | undefined,
): 'UNCHANGED' | 'LOW_VALUE_RESOLUTION' | undefined => {
  if (cluster.status === 'UNCHANGED') return 'UNCHANGED';
  if (cluster.status === 'RESOLVED' && cluster.importance < 70) {
    return 'LOW_VALUE_RESOLUTION';
  }
  if (
    previous &&
    cluster.status !== 'RESOLVED' &&
    comparableSummary(cluster.summary) ===
      comparableSummary(previous.lastSummary)
  ) {
    return 'UNCHANGED';
  }
  return undefined;
};

const normalizedKeywords = (values: readonly string[] = []): string[] =>
  values.map((value) => value.toLocaleLowerCase()).filter(Boolean);

const applyPersonalPriorities = (
  stories: readonly BriefingStoryCluster[],
  priorityKeywords: readonly string[] = [],
  mutedKeywords: readonly string[] = [],
): BriefingStoryCluster[] => {
  const priorities = normalizedKeywords(priorityKeywords);
  const muted = normalizedKeywords(mutedKeywords);
  return stories
    .map((story) => {
      const searchable = [
        story.title,
        story.summary,
        ...story.entities.flatMap(({ name, ticker }) => [name, ticker ?? '']),
        ...story.events.flatMap(({ tags }) => tags),
      ]
        .join(' ')
        .toLocaleLowerCase();
      const priorityMatches = priorities.filter((keyword) =>
        searchable.includes(keyword),
      ).length;
      const mutedMatches = muted.filter((keyword) =>
        searchable.includes(keyword),
      ).length;
      const mutedPenalty =
        story.urgency >= 90 ? 0 : Math.min(40, mutedMatches * 20);
      return {
        ...story,
        score: story.score + Math.min(30, priorityMatches * 15) - mutedPenalty,
      };
    })
    .sort((left, right) => right.score - left.score);
};

export class StoryEngine {
  public constructor(
    private readonly events: BriefingEventRepository,
    private readonly states: StoryStates,
    private readonly clusters?: ClusterPersistence,
    private readonly semanticMatcher?: Pick<
      SemanticStoryMatcher,
      'matchingPairs'
    >,
    private readonly logger?: WatcherLogger,
    private readonly newsCategoryPreferences?: NewsCategoryPreferences,
  ) {}

  public async collect(input: StoryEngineInput): Promise<StoryEngineResult> {
    if (Number.isNaN(input.periodStart.getTime())) {
      throw new Error('Story period start must be a valid date');
    }
    if (Number.isNaN(input.periodEnd.getTime())) {
      throw new Error('Story period end must be a valid date');
    }
    if (input.periodEnd < input.periodStart) {
      throw new Error('Story period end must not precede its start');
    }

    const rawEvents =
      input.subscriptions.length === 0
        ? []
        : await this.events.list({
            watcherBots: input.subscriptions,
            detectedAfter: input.periodStart,
            detectedThrough: input.periodEnd,
            detectedOrder: 'desc',
            limit: MAX_CANDIDATE_EVENTS,
          });
    const categoryPreferences =
      input.subscriptions.includes('news') && this.newsCategoryPreferences
        ? await this.newsCategoryPreferences.categoryPreferencesForTelegramChat(
            input.telegramChatId,
          )
        : [];
    const retrieved = rawEvents.filter((event) => {
      if (event.watcherBot !== 'news') return true;
      const scope = event.subcategory;
      const category = newsCategorySchema.safeParse(
        event.category.replace(/^NEWS_/u, ''),
      );
      if ((scope !== 'CZECH' && scope !== 'GLOBAL') || !category.success) {
        return true;
      }
      return isNewsCategoryEnabled(categoryPreferences, scope, category.data);
    });
    let semanticPairs: ReadonlySet<string> = new Set();
    if (this.semanticMatcher) {
      try {
        semanticPairs = await this.semanticMatcher.matchingPairs(retrieved);
      } catch (error) {
        this.logger?.warn(
          { err: error, eventCount: retrieved.length },
          'Semantic story matching failed; using deterministic clustering',
        );
      }
    }
    let clustered = clusterBriefingEvents(retrieved, semanticPairs);
    if (this.clusters) {
      clustered = await Promise.all(
        clustered.map((cluster) => this.persistCluster(cluster)),
      );
    }

    const previous = new Map(
      (await this.states.list(input.telegramChatId)).map((state) => [
        state.storyId,
        state,
      ]),
    );
    let unchangedSuppressed = 0;
    let resolvedSuppressed = 0;
    const selected = clustered.flatMap((cluster) => {
      const prior = previous.get(cluster.id);
      const suppression = shouldSuppress(cluster, prior);
      if (suppression === 'UNCHANGED' && !input.includePreviouslyMentioned) {
        unchangedSuppressed += 1;
        return [];
      }
      if (suppression === 'LOW_VALUE_RESOLUTION') {
        resolvedSuppressed += 1;
        return [];
      }
      return [applyContinuity(cluster, prior)];
    });
    const stories = applyPersonalPriorities(
      rankStories(selected),
      input.priorityKeywords,
      input.mutedKeywords,
    );
    const eventsByWatcher = Object.fromEntries(
      registeredWatcherBots.map((watcherBot) => [
        watcherBot,
        retrieved.filter((event) => event.watcherBot === watcherBot).length,
      ]),
    ) as Record<WatcherBotId, number>;
    const clusteredByWatcher = Object.fromEntries(
      registeredWatcherBots.map((watcherBot) => [
        watcherBot,
        clustered.filter(({ watcherBots }) => watcherBots.includes(watcherBot))
          .length,
      ]),
    ) as Record<WatcherBotId, number>;
    return {
      stories,
      metrics: {
        eventsRetrieved: retrieved.length,
        clustersCreated: clustered.length,
        duplicateReduction: retrieved.length - clustered.length,
        unchangedSuppressed,
        resolvedSuppressed,
        continuityStories: stories.filter(({ previouslyMentioned }) =>
          Boolean(previouslyMentioned),
        ).length,
        selected: stories.length,
        eventsByWatcher,
        duplicateReductionByWatcher: Object.fromEntries(
          registeredWatcherBots.map((watcherBot) => [
            watcherBot,
            Math.max(
              0,
              eventsByWatcher[watcherBot] - clusteredByWatcher[watcherBot],
            ),
          ]),
        ) as Record<WatcherBotId, number>,
      },
    };
  }

  private async persistCluster(
    cluster: BriefingStoryCluster,
  ): Promise<BriefingStoryCluster> {
    if (!this.clusters) return cluster;
    const identityCandidates = cluster.events.flatMap((event) => [
      event.id,
      ...(event.relatedEventIds ?? []),
    ]);
    const id =
      (await this.clusters.findIdByEventIds(identityCandidates)) ?? cluster.id;
    const identified = id === cluster.id ? cluster : { ...cluster, id };
    const saved = await this.clusters.save({
      id,
      eventIds: identified.eventIds,
      title: identified.title,
      summary: identified.summary,
      status: identified.status,
      importance: identified.importance,
      novelty: identified.novelty,
      relevance: identified.relevance,
      urgency: identified.urgency,
      actionable: identified.actionable,
      actionItems: identified.actionItems,
      watcherBots: identified.watcherBots,
      entities: identified.entities,
      sourceUrls: identified.sourceUrls,
      firstEventAt: new Date(identified.firstEventAt),
      lastEventAt: new Date(identified.lastEventAt),
    });
    return { ...identified, id: saved.id };
  }
}
