import { describe, expect, it, vi } from 'vitest';
import type { WatcherLogger } from '@watcher/core';
import type { EventSource, RawEvent } from '../domain/types.js';
import type { EventRepository } from '../repositories/event-repository.js';
import { EventRunner } from '../services/runner.js';
import type { BrnoEventPublisher } from '../services/event-publisher.js';

const candidate: RawEvent = {
  title: 'AI Meetup Brno',
  startAt: new Date('2026-09-10T16:00:00Z'),
  eventUrl: 'https://example.test/ai',
  categories: ['ai'],
  recurring: false,
  cancelled: false,
};
const source = (
  id: string,
  fetchUpcomingEvents: EventSource['fetchUpcomingEvents'],
): EventSource => ({
  id,
  name: id,
  url: `https://${id}.example.test`,
  intervalMinutes: 60,
  enabled: true,
  fetchUpcomingEvents,
});

describe('Brno event runner', () => {
  it('isolates a failed source and persists successful source results', async () => {
    const recordRun = vi.fn(async () => ({ id: 'source-run' }));
    const repository = {
      save: vi.fn(async () => 'created' as const),
      recordRun,
    } as unknown as EventRepository;
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
    } as unknown as WatcherLogger;
    const runner = new EventRunner(
      repository,
      [
        source('working', async () => [candidate]),
        source('broken', async () => {
          throw new Error('provider unavailable');
        }),
      ],
      logger,
    );

    const result = await runner.run();

    expect(result.status).toBe('partial');
    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'working', created: 1 }),
        expect.objectContaining({
          source: 'broken',
          status: 'failed',
          error: 'provider unavailable',
        }),
      ]),
    );
    expect(recordRun).toHaveBeenCalledTimes(2);
  });

  it('publishes newly discovered high-relevance events without failing the run', async () => {
    const repository = {
      save: vi.fn(async () => 'created' as const),
      recordRun: vi.fn(async () => ({ id: 'source-run' })),
    } as unknown as EventRepository;
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
    } as unknown as WatcherLogger;
    const publish = vi
      .fn<BrnoEventPublisher['publish']>()
      .mockResolvedValue(undefined);
    const runner = new EventRunner(
      repository,
      [
        source('ceitec', async () => [
          { ...candidate, categories: ['biology'] },
        ]),
      ],
      logger,
      { publish },
    );

    await runner.run();

    expect(publish).toHaveBeenCalledWith(
      'event.discovered',
      expect.objectContaining({ title: candidate.title }),
      'ceitec',
    );
    expect(publish).toHaveBeenCalledWith(
      'event.high_relevance',
      expect.any(Object),
      'ceitec',
    );
  });
});
