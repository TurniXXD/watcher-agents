import { describe, expect, it, vi } from 'vitest';
import { deduplicateItems } from '../deduplicate.js';
import { WatcherPipeline } from '../pipeline.js';
import { assertPublicHttpUrl } from '../network.js';
import { computeNextRun, PersistentScheduler, RunGuard } from '../scheduler.js';
import { watchItemSchema, type RunProgress, type WatchItem } from '../types.js';

const item = (externalId: string): WatchItem => ({
  id: `SEC:${externalId}`,
  source: 'SEC',
  externalId,
  title: 'Filing',
  url: 'https://www.sec.gov/example',
  content: 'Filing content',
  metadata: {},
});

describe('core watcher behavior', () => {
  it('normalizes and validates watch items', () => {
    expect(watchItemSchema.parse(item('1')).externalId).toBe('1');
  });

  it('rejects private and non-HTTP source URLs', () => {
    expect(() => assertPublicHttpUrl('http://127.0.0.1/feed')).toThrow();
    expect(() => assertPublicHttpUrl('http://[::1]/feed')).toThrow();
    expect(() => assertPublicHttpUrl('file:///etc/passwd')).toThrow();
  });

  it('deduplicates by source and external id', () => {
    expect(deduplicateItems([item('1'), item('1'), item('2')])).toHaveLength(2);
  });

  it('calculates the next cron occurrence in the requested timezone', () => {
    expect(
      computeNextRun(
        '0 8 * * *',
        'Europe/Prague',
        new Date('2026-01-01T08:00:00Z'),
      ),
    ).toEqual(new Date('2026-01-02T07:00:00.000Z'));
  });

  it('prevents overlapping work for the same key', async () => {
    const guard = new RunGuard();
    let release: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = guard.run('watcher', async () => waiting);
    expect(await guard.run('watcher', async () => 'duplicate')).toBeUndefined();
    release?.();
    await first;
  });

  it('waits for active scheduled work during shutdown', async () => {
    let release: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scheduler = new PersistentScheduler(
      async () => [{ id: 'watcher' }],
      async () => waiting,
    );
    const tick = scheduler.tick();
    const stopped = scheduler.stop();

    let finished = false;
    void stopped.then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    release?.();
    await Promise.all([tick, stopped]);
    expect(finished).toBe(true);
  });

  it('keeps successful sources when another source fails', async () => {
    const repository = {
      prepareItemsForRun: vi.fn(async (_kind, _runId, items: WatchItem[]) =>
        items.map((value, index) => ({ item: value, recordId: String(index) })),
      ),
      saveAnalysis: vi.fn(async () => undefined),
    };
    const analyzer = {
      analyze: vi.fn(async () => ({
        status: 'FAILED' as const,
        error: 'no model',
      })),
    };
    const pipeline = new WatcherPipeline(repository, analyzer);
    const result = await pipeline.run('STOCKS', 'run', [
      {
        source: { id: 'SEC', fetch: async () => [item('1')] },
        target: 'ELAN',
        config: {},
      },
      {
        source: {
          id: 'NEWS',
          fetch: async () => Promise.reject(new Error('timeout')),
        },
        target: 'ELAN',
        config: {},
      },
    ]);

    expect(result.newItemCount).toBe(1);
    expect(result.sourceFailures).toEqual([
      { source: 'NEWS', target: 'ELAN', message: 'timeout' },
    ]);
  });

  it('reports pipeline progress while fetching and analyzing items', async () => {
    const progress: RunProgress[] = [];
    const repository = {
      prepareItemsForRun: vi.fn(async (_kind, _runId, items: WatchItem[]) =>
        items.map((value, index) => ({ item: value, recordId: String(index) })),
      ),
      saveAnalysis: vi.fn(async () => undefined),
    };
    const analyzer = {
      analyze: vi.fn(async () => ({
        status: 'FAILED' as const,
        error: 'no model',
      })),
    };
    const pipeline = new WatcherPipeline(repository, analyzer);

    await pipeline.run(
      'STOCKS',
      'run',
      [
        {
          source: { id: 'SEC', fetch: async () => [item('1')] },
          target: 'ELAN',
          config: {},
        },
      ],
      {
        analysisStep: 'Analyzing fundamentals',
        onProgress: (entry) => {
          progress.push(entry);
        },
      },
    );

    expect(progress.map((entry) => entry.step)).toEqual([
      'Fetching sources',
      'Preparing new items',
      'Analyzing fundamentals',
      'Saving results',
    ]);
  });

  it('caps and serializes expensive analysis work', async () => {
    let reservedCount = 0;
    let active = 0;
    let maximumActive = 0;
    const repository = {
      prepareItemsForRun: vi.fn(async (_kind, _runId, items: WatchItem[]) => {
        const selected = items.slice(0, 2);
        reservedCount = selected.length;
        return selected.map((value, index) => ({
          item: value,
          recordId: String(index),
        }));
      }),
      saveAnalysis: vi.fn(async () => undefined),
    };
    const analyzer = {
      analyze: vi.fn(async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Promise.resolve();
        active -= 1;
        return { status: 'FAILED' as const, error: 'test' };
      }),
    };
    const pipeline = new WatcherPipeline(repository, analyzer, 2);

    const result = await pipeline.run('STOCKS', 'run', [
      {
        source: {
          id: 'SEC',
          fetch: async () => [item('1'), item('2'), item('3')],
        },
        target: 'ELAN',
        config: {},
      },
    ]);

    expect(result.fetchedCount).toBe(3);
    expect(result.newItemCount).toBe(2);
    expect(reservedCount).toBe(2);
    expect(maximumActive).toBe(1);
  });

  it('uses unlimited item processing by default', async () => {
    const repository = {
      prepareItemsForRun: vi.fn(async () => []),
      saveAnalysis: vi.fn(async () => undefined),
    };
    const pipeline = new WatcherPipeline(repository, {
      analyze: vi.fn(async () => ({
        status: 'FAILED' as const,
        error: 'test',
      })),
    });

    await pipeline.run('STOCKS', 'run', [
      {
        source: {
          id: 'SEC',
          fetch: async () => [item('1'), item('2')],
        },
        target: 'ELAN',
        config: {},
      },
    ]);

    expect(repository.prepareItemsForRun).toHaveBeenCalledWith(
      'STOCKS',
      'run',
      [
        { ...item('1'), metadata: { target: 'ELAN' } },
        { ...item('2'), metadata: { target: 'ELAN' } },
      ],
      0,
    );
  });

  it('reuses cached successful analyses without calling the analyzer', async () => {
    const cached = {
      status: 'SUCCESS' as const,
      result: {
        title: 'Filing',
        summary: 'Previously analyzed filing.',
        importance: 4,
        sentiment: 'neutral' as const,
        eventType: '8-K',
        positives: [],
        negatives: [],
        risks: [],
        catalysts: [],
        confidence: 0.8,
      },
    };
    const repository = {
      prepareItemsForRun: vi.fn(async (_kind, _runId, items: WatchItem[]) => [
        { item: items[0]!, recordId: 'record', outcome: cached },
      ]),
      saveAnalysis: vi.fn(async () => undefined),
    };
    const analyzer = {
      analyze: vi.fn(async () => ({
        status: 'FAILED' as const,
        error: 'should not run',
      })),
    };
    const pipeline = new WatcherPipeline(repository, analyzer);

    const result = await pipeline.run('STOCKS', 'run', [
      {
        source: { id: 'SEC', fetch: async () => [item('1')] },
        target: 'ELAN',
        config: {},
      },
    ]);

    expect(analyzer.analyze).not.toHaveBeenCalled();
    expect(result.analyses[0]?.outcome).toEqual(cached);
    expect(repository.saveAnalysis).toHaveBeenCalledWith(
      'run',
      'record',
      cached,
    );
  });

  it('records a failed analysis when the analyzer throws', async () => {
    const repository = {
      prepareItemsForRun: vi.fn(async (_kind, _runId, items: WatchItem[]) => [
        { item: items[0]!, recordId: 'record' },
      ]),
      saveAnalysis: vi.fn(async () => undefined),
    };
    const pipeline = new WatcherPipeline(repository, {
      analyze: vi.fn(async () => Promise.reject(new Error('overloaded'))),
    });

    const result = await pipeline.run('STOCKS', 'run', [
      {
        source: { id: 'SEC', fetch: async () => [item('1')] },
        target: 'ELAN',
        config: {},
      },
    ]);

    expect(result.failedAnalysisCount).toBe(1);
    expect(repository.saveAnalysis).toHaveBeenCalledWith('run', 'record', {
      status: 'FAILED',
      error: 'overloaded',
    });
  });
});
