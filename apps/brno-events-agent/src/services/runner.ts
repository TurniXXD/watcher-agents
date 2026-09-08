import type { WatcherLogger } from '@watcher/core';
import type { EventSource } from '../domain/types.js';
import type { EventRepository } from '../repositories/event-repository.js';
import { scoreEvent } from './relevance.js';
import {
  noOpEventPublisher,
  type BrnoEventPublisher,
  type BrnoEventMessageType,
} from './event-publisher.js';

export class EventRunner {
  readonly #running = new Set<string>();
  public constructor(
    private readonly repository: EventRepository,
    private readonly sources: EventSource[],
    private readonly logger: WatcherLogger,
    private readonly publisher: BrnoEventPublisher = noOpEventPublisher,
  ) {}
  public sourceIds(): string[] {
    return this.sources.map((source) => source.id);
  }
  public async run(sourceId?: string) {
    const selected = sourceId
      ? this.sources.filter((source) => source.id === sourceId)
      : this.sources.filter((source) => source.enabled);
    if (sourceId && selected.length === 0)
      throw new Error(`Unknown source: ${sourceId}`);
    const settled = await Promise.allSettled(
      selected.map((source) => this.runSource(source)),
    );
    const results = settled.map((outcome, index) =>
      outcome.status === 'fulfilled'
        ? outcome.value
        : {
            source: selected[index]!.id,
            status: 'failed',
            error:
              outcome.reason instanceof Error
                ? outcome.reason.message
                : String(outcome.reason),
          },
    );
    return {
      status: results.some((result) => result.status === 'failed')
        ? 'partial'
        : 'success',
      results,
    };
  }
  public async runDue(lastRuns: Map<string, Date>, now = new Date()) {
    const due = this.sources.filter(
      (source) =>
        source.enabled &&
        now.getTime() - (lastRuns.get(source.id)?.getTime() ?? 0) >=
          source.intervalMinutes * 60_000,
    );
    return Promise.allSettled(due.map((source) => this.runSource(source)));
  }
  private async runSource(source: EventSource) {
    if (this.#running.has(source.id))
      return { source: source.id, status: 'busy' as const };
    this.#running.add(source.id);
    const startedAt = new Date();
    let fetched = 0,
      created = 0,
      updated = 0,
      duplicates = 0;
    try {
      const events = await source.fetchUpcomingEvents({ now: startedAt });
      fetched = events.length;
      for (const event of events) {
        const result = await this.repository.save(source, event, startedAt);
        if (result === 'created') created++;
        else if (result === 'updated') updated++;
        else duplicates++;
        if (result !== 'duplicate') {
          await this.publishEventUpdates(source.id, event, result, startedAt);
        }
      }
      await this.repository.recordRun(source.id, {
        startedAt,
        success: true,
        fetched,
        created,
        updated,
        duplicates,
      });
      const result = {
        source: source.id,
        status: 'success' as const,
        fetched,
        created,
        updated,
        duplicates,
        durationMs: Date.now() - startedAt.getTime(),
      };
      this.logger.info(result, 'Brno event source completed');
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.repository.recordRun(source.id, {
        startedAt,
        success: false,
        fetched,
        created,
        updated,
        duplicates,
        error: message.slice(0, 5000),
      });
      this.logger.warn(
        { source: source.id, err: error },
        'Brno event source failed',
      );
      throw error;
    } finally {
      this.#running.delete(source.id);
    }
  }

  private async publishEventUpdates(
    sourceId: string,
    event: Awaited<ReturnType<EventSource['fetchUpcomingEvents']>>[number],
    result: 'created' | 'updated',
    now: Date,
  ): Promise<void> {
    const types: BrnoEventMessageType[] = [
      result === 'created' ? 'event.discovered' : 'event.updated',
      ...(event.cancelled ? (['event.cancelled'] as const) : []),
      ...(scoreEvent(event, now).score >= 80
        ? (['event.high_relevance'] as const)
        : []),
    ];
    const published = await Promise.allSettled(
      types.map((type) => this.publisher.publish(type, event, sourceId)),
    );
    for (const failure of published) {
      if (failure.status === 'rejected') {
        this.logger.warn(
          { source: sourceId, err: failure.reason },
          'Brno event publication failed',
        );
      }
    }
  }
}
