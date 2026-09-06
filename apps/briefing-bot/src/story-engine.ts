import type { BriefingEventRepository, WatcherBotId } from '@watcher/core';
import type {
  BriefingStoryClusterStore,
  BriefingStoryStateRecord,
  BriefingStoryStore,
} from '@watcher/database';
import { clusterBriefingEvents } from './story-clustering.js';
import { rankStories } from './story-ranking.js';
import type { BriefingStoryCluster, StoryEngineResult } from './story-types.js';

type StoryStates = Pick<BriefingStoryStore, 'list'>;
type ClusterPersistence = Pick<
  BriefingStoryClusterStore,
  'findIdByEventIds' | 'save'
>;

export type StoryEngineInput = {
  telegramChatId: bigint;
  subscriptions: readonly WatcherBotId[];
  periodStart: Date;
  periodEnd: Date;
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

export class StoryEngine {
  public constructor(
    private readonly events: BriefingEventRepository,
    private readonly states: StoryStates,
    private readonly clusters?: ClusterPersistence,
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

    const retrieved =
      input.subscriptions.length === 0
        ? []
        : await this.events.list({
            watcherBots: input.subscriptions,
            detectedAfter: input.periodStart,
            detectedThrough: input.periodEnd,
            limit: 500,
          });
    let clustered = clusterBriefingEvents(retrieved);
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
      if (suppression === 'UNCHANGED') {
        unchangedSuppressed += 1;
        return [];
      }
      if (suppression === 'LOW_VALUE_RESOLUTION') {
        resolvedSuppressed += 1;
        return [];
      }
      return [applyContinuity(cluster, prior)];
    });
    const stories = rankStories(selected);
    const eventsByWatcher = {
      stocks: retrieved.filter(({ watcherBot }) => watcherBot === 'stocks')
        .length,
      medical: retrieved.filter(({ watcherBot }) => watcherBot === 'medical')
        .length,
    };
    const clusteredByWatcher = {
      stocks: clustered.filter(({ watcherBots }) =>
        watcherBots.includes('stocks'),
      ).length,
      medical: clustered.filter(({ watcherBots }) =>
        watcherBots.includes('medical'),
      ).length,
    };
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
        duplicateReductionByWatcher: {
          stocks: Math.max(
            0,
            eventsByWatcher.stocks - clusteredByWatcher.stocks,
          ),
          medical: Math.max(
            0,
            eventsByWatcher.medical - clusteredByWatcher.medical,
          ),
        },
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
