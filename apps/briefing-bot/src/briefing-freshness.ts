import type { WatcherBotId, WatcherLogger } from '@watcher/core';
import type {
  BriefingWatcherHealthRecord,
  BriefingWatcherHealthStore,
} from '@watcher/database';

type WatcherHealth = Pick<BriefingWatcherHealthStore, 'list'>;

export type BriefingFreshnessResult = {
  health: BriefingWatcherHealthRecord[];
  staleWatchers: WatcherBotId[];
  waitedMs: number;
  timedOut: boolean;
};

const sleepFor = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const staleWatcherIds = (
  subscriptions: readonly WatcherBotId[],
  health: readonly BriefingWatcherHealthRecord[],
  cutoff: Date,
): WatcherBotId[] => {
  const byWatcher = new Map(
    health.map((record) => [record.watcherBot, record]),
  );
  return subscriptions.filter((watcherBot) => {
    const lastRunAt = byWatcher.get(watcherBot)?.lastRunAt;
    return !lastRunAt || new Date(lastRunAt) < cutoff;
  });
};

export const waitForFreshWatcherRuns = async (input: {
  watcherHealth: WatcherHealth;
  subscriptions: readonly WatcherBotId[];
  referenceTime: Date;
  maximumAgeMs: number;
  timeoutMs: number;
  pollIntervalMs: number;
  sleep?: (milliseconds: number) => Promise<void>;
  clock?: () => number;
  logger?: WatcherLogger;
}): Promise<BriefingFreshnessResult> => {
  const startedAt = input.clock?.() ?? Date.now();
  const cutoff = new Date(input.referenceTime.getTime() - input.maximumAgeMs);
  let health = await input.watcherHealth.list(input.subscriptions);
  let staleWatchers = staleWatcherIds(input.subscriptions, health, cutoff);
  while (staleWatchers.length > 0) {
    const elapsed = (input.clock?.() ?? Date.now()) - startedAt;
    if (elapsed >= input.timeoutMs) {
      input.logger?.warn(
        {
          staleWatchers,
          cutoff: cutoff.toISOString(),
          waitedMs: elapsed,
        },
        'Briefing freshness gate timed out; continuing with available data',
      );
      return { health, staleWatchers, waitedMs: elapsed, timedOut: true };
    }
    input.logger?.info(
      { staleWatchers, cutoff: cutoff.toISOString(), waitedMs: elapsed },
      'Waiting for fresh watcher runs before scheduled briefing',
    );
    await (input.sleep ?? sleepFor)(
      Math.min(input.pollIntervalMs, input.timeoutMs - elapsed),
    );
    health = await input.watcherHealth.list(input.subscriptions);
    staleWatchers = staleWatcherIds(input.subscriptions, health, cutoff);
  }
  return {
    health,
    staleWatchers: [],
    waitedMs: (input.clock?.() ?? Date.now()) - startedAt,
    timedOut: false,
  };
};
