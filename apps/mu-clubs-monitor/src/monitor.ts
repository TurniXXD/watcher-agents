import type { BriefingEventRepository, WatcherLogger } from '@watcher/core';
import type { BriefingWatcherHealthStore } from '@watcher/database';
import { publishClubBriefingEvents } from './briefing-publisher.js';
import { HeuristicActivityClassifier } from './classifier.js';
import type {
  ClubSourceDefinition,
  ClubSourceType,
  MonitorSource,
} from './types.js';
import type { MuClubsStore } from './store.js';

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export type MuMonitorResult = {
  status: 'BUSY' | 'SUCCESS' | 'PARTIAL' | 'FAILED';
  runId?: string;
  sourceCount: number;
  fetchedCount: number;
  activityCount: number;
  sourceFailures: Array<{ sourceId: string; message: string }>;
  briefingPublished: number;
};

export class MuClubsMonitor {
  readonly #sources: Map<ClubSourceType, MonitorSource>;

  public constructor(
    private readonly store: MuClubsStore,
    sources: Partial<Record<ClubSourceType, MonitorSource>>,
    private readonly briefingEvents: BriefingEventRepository,
    private readonly health: BriefingWatcherHealthStore,
    private readonly intervalMs: number,
    private readonly logger?: WatcherLogger,
  ) {
    this.#sources = new Map(
      Object.entries(sources) as Array<[ClubSourceType, MonitorSource]>,
    );
  }

  public async run(
    trigger: 'MANUAL' | 'SCHEDULED',
    signal?: AbortSignal,
  ): Promise<MuMonitorResult> {
    const run = await this.store.claimRun(trigger);
    if (!run)
      return {
        status: 'BUSY',
        sourceCount: 0,
        fetchedCount: 0,
        activityCount: 0,
        sourceFailures: [],
        briefingPublished: 0,
      };
    const classifier = new HeuristicActivityClassifier();
    let sources: Awaited<ReturnType<MuClubsStore['listSources']>> = [];
    const sourceFailures: MuMonitorResult['sourceFailures'] = [];
    const briefingEntries: Array<{
      club: { id: string; name: string; slug: string };
      activity: Awaited<ReturnType<MuClubsStore['saveActivity']>>['activity'];
    }> = [];
    let fetchedCount = 0;
    try {
      sources = await this.store.listSources({
        dueAt: new Date(),
        ignoreSchedule: trigger === 'MANUAL',
      });
      const settled = await Promise.allSettled(
        sources.map(async (source) => {
          const adapter = this.#sources.get(source.type);
          if (!adapter)
            throw new Error(`No provider is configured for ${source.type}`);
          const definition: ClubSourceDefinition = {
            id: source.id,
            type: source.type,
            ...(source.url ? { url: source.url } : {}),
            ...(source.username ? { username: source.username } : {}),
            status: 'ACTIVE',
          };
          const startedAt = Date.now();
          try {
            const candidates = await adapter.fetch(definition, signal);
            await this.store.recordSourceRun(run.id, source.id, {
              success: true,
              itemCount: candidates.length,
              durationMs: Date.now() - startedAt,
            });
            return { source, candidates };
          } catch (error) {
            await this.store.recordSourceRun(run.id, source.id, {
              success: false,
              itemCount: 0,
              durationMs: Date.now() - startedAt,
              error: errorMessage(error).slice(0, 5_000),
            });
            throw error;
          }
        }),
      );

      for (const [index, outcome] of settled.entries()) {
        const source = sources[index]!;
        if (outcome.status === 'rejected') {
          sourceFailures.push({
            sourceId: source.id,
            message: errorMessage(outcome.reason),
          });
          continue;
        }
        fetchedCount += outcome.value.candidates.length;
        for (const candidate of outcome.value.candidates) {
          const classification = classifier.classify(candidate);
          if (!classification.relevant) continue;
          const saved = await this.store.saveActivity(
            source.clubId,
            source.id,
            candidate,
            classification,
          );
          if (saved.created)
            briefingEntries.push({
              club: source.club,
              activity: saved.activity,
            });
        }
      }
      const publication = await publishClubBriefingEvents(
        this.briefingEvents,
        briefingEntries,
        this.logger,
      );
      const degraded = sourceFailures.length > 0 || publication.failed > 0;
      await this.health.recordRun({
        watcherBot: 'mu-clubs',
        degraded,
        eventsEmitted: publication.published,
        failedEventPublications: publication.failed,
        sourceFailures: sourceFailures.length,
      });
      const status = degraded ? 'PARTIAL' : 'SUCCESS';
      await this.store.finishRun(run.id, {
        status,
        sourceCount: sources.length,
        fetchedCount,
        activityCount: briefingEntries.length,
        sourceFailures: sourceFailures.length,
        nextRunAt: new Date(Date.now() + this.intervalMs),
      });
      this.logger?.info(
        {
          runId: run.id,
          sourceCount: sources.length,
          fetchedCount,
          activityCount: briefingEntries.length,
          sourceFailureCount: sourceFailures.length,
          briefingPublished: publication.published,
        },
        'MU Clubs monitor run completed',
      );
      return {
        status,
        runId: run.id,
        sourceCount: sources.length,
        fetchedCount,
        activityCount: briefingEntries.length,
        sourceFailures,
        briefingPublished: publication.published,
      };
    } catch (error) {
      const message = errorMessage(error);
      await this.store.finishRun(run.id, {
        status: 'FAILED',
        sourceCount: sources.length,
        fetchedCount,
        activityCount: briefingEntries.length,
        sourceFailures: sourceFailures.length,
        error: message.slice(0, 5_000),
        nextRunAt: new Date(Date.now() + this.intervalMs),
      });
      await this.health.recordFailure({
        watcherBot: 'mu-clubs',
        error: message.slice(0, 5_000),
      });
      this.logger?.error(
        { runId: run.id, err: error },
        'MU Clubs monitor run failed',
      );
      return {
        status: 'FAILED',
        runId: run.id,
        sourceCount: sources.length,
        fetchedCount,
        activityCount: briefingEntries.length,
        sourceFailures,
        briefingPublished: 0,
      };
    }
  }
}
