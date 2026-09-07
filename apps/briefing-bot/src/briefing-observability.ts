import { registeredWatcherBots, type WatcherBotId } from '@watcher/core';
import type { BriefingWatcherHealthRecord } from '@watcher/database';
import type { ContextAvailability } from './script-generator.js';
import type {
  BriefingStoryCluster,
  StoryEngineMetrics,
} from './story-types.js';

type BriefingWatcherHealthStatus = BriefingWatcherHealthRecord['status'];

export type CoverageComponent = {
  id: WatcherBotId | 'weather' | 'calendar';
  status: BriefingWatcherHealthStatus | ContextAvailability;
  score: number;
};

export type BriefingCoverage = {
  percentage: number;
  components: CoverageComponent[];
};

const healthScore = (status: BriefingWatcherHealthStatus): number =>
  status === 'HEALTHY' ? 1 : status === 'DEGRADED' ? 0.5 : 0;

const contextScore = (status: ContextAvailability): number =>
  status === 'AVAILABLE' ? 1 : 0;

export const calculateBriefingCoverage = (input: {
  subscriptions: readonly WatcherBotId[];
  watcherHealth: readonly BriefingWatcherHealthRecord[];
  weather: ContextAvailability;
  calendar: ContextAvailability;
  now: Date;
  watcherStaleAfterMs?: number;
}): BriefingCoverage => {
  const staleAfterMs = input.watcherStaleAfterMs ?? 36 * 60 * 60_000;
  const healthByWatcher = new Map(
    input.watcherHealth.map((health) => [health.watcherBot, health]),
  );
  const components: CoverageComponent[] = input.subscriptions.map(
    (watcherBot) => {
      const health = healthByWatcher.get(watcherBot);
      const stale =
        !health ||
        input.now.getTime() - new Date(health.lastRunAt).getTime() >
          staleAfterMs;
      const status = stale ? 'UNAVAILABLE' : health.status;
      return { id: watcherBot, status, score: healthScore(status) };
    },
  );
  if (input.weather !== 'DISABLED') {
    components.push({
      id: 'weather',
      status: input.weather,
      score: contextScore(input.weather),
    });
  }
  if (input.calendar !== 'DISABLED') {
    components.push({
      id: 'calendar',
      status: input.calendar,
      score: contextScore(input.calendar),
    });
  }
  return {
    percentage:
      components.length === 0
        ? 100
        : Math.round(
            (components.reduce(
              (total, component) => total + component.score,
              0,
            ) /
              components.length) *
              100,
          ),
    components,
  };
};

export type WatcherNoiseMetrics = {
  eventsEmitted: number;
  eventsSelected: number;
  eventsOmitted: number;
  selectionRate: number;
  duplicateRate: number;
  flaggedForTuning: boolean;
};

const percentage = (part: number, total: number): number =>
  total === 0 ? 0 : Math.round((part / total) * 10_000) / 100;

export const calculateWatcherNoise = (
  metrics: StoryEngineMetrics,
  selectedStories: readonly BriefingStoryCluster[],
): Record<WatcherBotId, WatcherNoiseMetrics> => {
  const selectedEventIds = Object.fromEntries(
    registeredWatcherBots.map((watcherBot) => [watcherBot, new Set<string>()]),
  ) as Record<WatcherBotId, Set<string>>;
  for (const story of selectedStories) {
    for (const event of story.events) {
      selectedEventIds[event.watcherBot].add(event.id);
    }
  }
  return Object.fromEntries(
    registeredWatcherBots.map((watcherBot) => {
      const eventsEmitted = metrics.eventsByWatcher[watcherBot] ?? 0;
      const eventsSelected = selectedEventIds[watcherBot].size;
      const selectionRate = percentage(eventsSelected, eventsEmitted);
      return [
        watcherBot,
        {
          eventsEmitted,
          eventsSelected,
          eventsOmitted: Math.max(0, eventsEmitted - eventsSelected),
          selectionRate,
          duplicateRate: percentage(
            metrics.duplicateReductionByWatcher[watcherBot] ?? 0,
            eventsEmitted,
          ),
          flaggedForTuning: eventsEmitted >= 20 && selectionRate < 10,
        },
      ];
    }),
  ) as Record<WatcherBotId, WatcherNoiseMetrics>;
};

export type BriefingRunMetrics = {
  watcherHealth: Record<WatcherBotId, BriefingWatcherHealthStatus>;
  events: {
    total: number;
    selected: number;
    omitted: number;
    duplicateReduction: number;
    unchangedSuppressed: number;
  };
  noise: Record<WatcherBotId, WatcherNoiseMetrics>;
  latencyMs: {
    weather: number;
    calendar: number;
    watcherEvents: number;
    script: number;
    piper?: number;
    telegramUpload: number;
  };
  failedDeliveries: number;
  dataCoverage: number;
  voice: string;
  targetDurationSeconds: number;
  maximumDurationSeconds: number;
  plannedDurationSeconds: number;
  actualAudioDurationSeconds?: number;
  wordCount: number;
};

export const watcherHealthFromCoverage = (
  coverage: BriefingCoverage,
): BriefingRunMetrics['watcherHealth'] =>
  Object.fromEntries(
    registeredWatcherBots.map((watcherBot) => [
      watcherBot,
      coverage.components.find(({ id }) => id === watcherBot)?.status ??
        'UNAVAILABLE',
    ]),
  ) as BriefingRunMetrics['watcherHealth'];

export const buildBriefingRunMetrics = (input: {
  storyMetrics: StoryEngineMetrics;
  selectedStories: readonly BriefingStoryCluster[];
  coverage: BriefingCoverage;
  latencyMs: BriefingRunMetrics['latencyMs'];
  failedDeliveries: number;
  voice: string;
  targetDurationSeconds: number;
  maximumDurationSeconds: number;
  plannedDurationSeconds: number;
  actualAudioDurationSeconds?: number;
  wordCount: number;
}): BriefingRunMetrics => {
  const noise = calculateWatcherNoise(
    input.storyMetrics,
    input.selectedStories,
  );
  const selected = Object.values(noise).reduce(
    (total, metrics) => total + metrics.eventsSelected,
    0,
  );
  return {
    watcherHealth: watcherHealthFromCoverage(input.coverage),
    events: {
      total: input.storyMetrics.eventsRetrieved,
      selected,
      omitted: Math.max(0, input.storyMetrics.eventsRetrieved - selected),
      duplicateReduction: input.storyMetrics.duplicateReduction,
      unchangedSuppressed: input.storyMetrics.unchangedSuppressed,
    },
    noise,
    latencyMs: input.latencyMs,
    failedDeliveries: input.failedDeliveries,
    dataCoverage: input.coverage.percentage,
    voice: input.voice,
    targetDurationSeconds: input.targetDurationSeconds,
    maximumDurationSeconds: input.maximumDurationSeconds,
    plannedDurationSeconds: input.plannedDurationSeconds,
    ...(input.actualAudioDurationSeconds === undefined
      ? {}
      : { actualAudioDurationSeconds: input.actualAudioDurationSeconds }),
    wordCount: input.wordCount,
  };
};
