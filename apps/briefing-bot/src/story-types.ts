import type {
  BriefingEntity,
  BriefingEvent,
  BriefingEventStatus,
  WatcherBotId,
} from '@watcher/core';

export type StoryPerspective = {
  watcherBot: WatcherBotId;
  category: string;
  summary: string;
  confidence: BriefingEvent['confidence'];
};

export type BriefingStoryCluster = {
  id: string;
  eventIds: string[];
  events: BriefingEvent[];
  title: string;
  summary: string;
  status: BriefingEventStatus;
  importance: number;
  novelty: number;
  relevance: number;
  urgency: number;
  actionable: boolean;
  actionItems: string[];
  watcherBots: WatcherBotId[];
  entities: BriefingEntity[];
  sourceUrls: string[];
  perspectives: StoryPerspective[];
  firstEventAt: string;
  lastEventAt: string;
  score: number;
  previousSummary?: string;
  previouslyMentioned: boolean;
};

export type StoryEngineMetrics = {
  eventsRetrieved: number;
  clustersCreated: number;
  duplicateReduction: number;
  unchangedSuppressed: number;
  resolvedSuppressed: number;
  continuityStories: number;
  selected: number;
  eventsByWatcher: Record<WatcherBotId, number>;
  duplicateReductionByWatcher: Record<WatcherBotId, number>;
};

export type StoryEngineResult = {
  stories: BriefingStoryCluster[];
  metrics: StoryEngineMetrics;
};
