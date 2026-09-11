import { describe, expect, it, vi } from 'vitest';
import { deduplicateItems } from '../deduplicate.js';
import { WatcherPipeline } from '../pipeline.js';
import { SourceHttpError } from '../source-http-error.js';
import { WatcherRunner } from '../runner.js';
import { computeNextRun, PersistentScheduler, RunGuard } from '../scheduler.js';
import {
  watchItemSchema,
  type AnalysisOutcome,
  type RunProgress,
  type WatchItem,
} from '../types.js';

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

  it('removes PostgreSQL-incompatible null bytes from watch items', () => {
    const parsed = watchItemSchema.parse({
      ...item('nul-byte'),
      title: 'Filing\u0000 update',
      content: 'Material\u0000 filing content',
      normalizedFacts: {
        'form\u0000type': '8-K\u0000',
        nested: ['safe\u0000 text'],
      },
      entities: ['MU\u0000'],
      metadata: { symbol: 'M\u0000U' },
    });

    expect(parsed).toMatchObject({
      title: 'Filing update',
      content: 'Material filing content',
      normalizedFacts: {
        formtype: '8-K',
        nested: ['safe text'],
      },
      entities: ['MU'],
      metadata: { symbol: 'MU' },
    });
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

  it('calculates the next occurrence across multiple cron expressions', () => {
    const schedule = '0 7 * * 1-5; 30 8 * * 1-5; 0 20 * * 1-5';

    expect(
      computeNextRun(
        schedule,
        'America/New_York',
        new Date('2026-09-07T11:10:00.000Z'),
      ),
    ).toEqual(new Date('2026-09-07T12:30:00.000Z'));
    expect(
      computeNextRun(
        schedule,
        'America/New_York',
        new Date('2026-09-07T13:00:00.000Z'),
      ),
    ).toEqual(new Date('2026-09-08T00:00:00.000Z'));
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
      saveAnalysis: vi.fn(
        async (runId: string, recordId: string, outcome: AnalysisOutcome) => {
          void runId;
          void recordId;
          void outcome;
        },
      ),
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
    expect(result.dataCoverage).toEqual({
      expectedSources: 2,
      successfulSources: 1,
      unavailableSources: 1,
      percentage: 50,
    });
  });

  it('stops queued requests for a provider after its first rate limit', async () => {
    const retryAt = new Date(Date.now() + 60_000);
    const fetchSource = vi.fn(async () => {
      throw new SourceHttpError(429, 'api.gdeltproject.org', retryAt);
    });
    const recordSourceFailure = vi.fn(async () => undefined);
    const source = {
      id: 'NEWS',
      capabilities: {
        sourceName: 'GDELT',
        sourceType: 'NEWS' as const,
        minimumIntervalMs: 0,
        preferredIntervalMs: 0,
        maximumIntervalMs: 0,
        supportsStreaming: false,
        costPerRequestUsd: 0,
        rateLimitPerMinute: null,
        priority: 1,
        requestPolicy: {
          maxConcurrency: 1,
          minimumSpacingMs: 0,
          sharedRateLimitBackoff: true,
        },
      },
      fetch: fetchSource,
    };
    const pipeline = new WatcherPipeline(
      {
        prepareItemsForRun: vi.fn(async () => []),
        saveAnalysis: vi.fn(async () => undefined),
        recordSourceFailure,
      },
      { analyze: vi.fn() },
    );

    const result = await pipeline.run('STOCKS', 'run', [
      { source, target: 'MU', config: {} },
      { source, target: 'NVDA', config: {} },
    ]);

    expect(fetchSource).toHaveBeenCalledOnce();
    expect(recordSourceFailure).toHaveBeenCalledOnce();
    expect(recordSourceFailure).toHaveBeenCalledWith(
      'STOCKS',
      'run',
      'NEWS',
      'MU',
      expect.stringContaining('HTTP 429'),
      expect.any(Date),
      {
        sharedRateLimitBackoff: true,
        rateLimited: true,
        retryAt,
      },
    );
    expect(result.sourceFailures).toHaveLength(2);
    expect(result.sourceFailures[1]?.message).toContain(
      'RATE_LIMITED provider backoff active',
    );
  });

  it('isolates source output that fails runtime validation', async () => {
    const repository = {
      prepareItemsForRun: vi.fn(async (_kind, _runId, items: WatchItem[]) =>
        items.map((value, index) => ({ item: value, recordId: String(index) })),
      ),
      saveAnalysis: vi.fn(async () => undefined),
    };
    const pipeline = new WatcherPipeline(repository, {
      analyze: vi.fn(async () => ({
        status: 'FAILED' as const,
        error: 'no model',
      })),
    });

    const result = await pipeline.run('STOCKS', 'run', [
      {
        source: { id: 'SEC', fetch: async () => [item('valid')] },
        target: 'MU',
        config: {},
      },
      {
        source: {
          id: 'NEWS',
          fetch: async () => [{ ...item('invalid'), url: 'not-a-url' }],
        },
        target: 'MU',
        config: {},
      },
    ]);

    expect(result.fetchedCount).toBe(1);
    expect(result.sourceFailures).toHaveLength(1);
    expect(result.sourceFailures[0]).toMatchObject({
      source: 'NEWS',
      target: 'MU',
    });
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
    expect(result.duplicatesRemoved).toBe(0);
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
      saveAnalysis: vi.fn(
        async (runId: string, recordId: string, outcome: AnalysisOutcome) => {
          void runId;
          void recordId;
          void outcome;
        },
      ),
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
    expect(repository.saveAnalysis).toHaveBeenCalledOnce();
    expect(repository.saveAnalysis.mock.calls[0]?.[2]).toMatchObject({
      status: 'FAILED',
      error: 'overloaded',
      metrics: {
        llmCallCount: 1,
        estimatedCostUsd: 0,
      },
    });
  });

  it('logs analyzer-returned failures with item context', async () => {
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const pipeline = new WatcherPipeline(
      {
        prepareItemsForRun: vi.fn(async (_kind, _runId, items: WatchItem[]) => [
          { item: items[0]!, recordId: 'record' },
        ]),
        saveAnalysis: vi.fn(async () => undefined),
      },
      {
        analyze: vi.fn(async () => ({
          status: 'FAILED' as const,
          error: 'Ollama returned HTTP 400',
        })),
      },
      0,
      logger,
    );

    await pipeline.run('PUBLICATIONS', 'run', [
      {
        source: {
          id: 'PUBMED',
          fetch: async () => [
            { ...item('1'), id: 'PUBMED:1', source: 'PUBMED' },
          ],
        },
        target: 'fungi',
        config: {},
      },
    ]);

    expect(logger.warn).toHaveBeenCalledWith(
      {
        kind: 'PUBLICATIONS',
        runId: 'run',
        source: 'PUBMED',
        externalId: '1',
        analysisError: 'Ollama returned HTTP 400',
      },
      'Watcher item analysis failed',
    );
  });

  it('limits high-resolution runs to selected tickers and fast sources', async () => {
    const secMu = vi.fn(async () => []);
    const newsMu = vi.fn(async () => []);
    const secXyz = vi.fn(async () => []);
    const pipeline = new WatcherPipeline(
      {
        prepareItemsForRun: vi.fn(async () => []),
        saveAnalysis: vi.fn(async () => undefined),
      },
      {
        analyze: vi.fn(async () => ({
          status: 'FAILED' as const,
          error: 'unused',
        })),
      },
    );
    const afterRun = vi.fn(async () => undefined);
    const notify = vi.fn(async () => undefined);
    const store = {
      claimRun: vi.fn(async () => ({ id: 'run' })),
      finishRun: vi.fn(async () => undefined),
      recordSourceFailures: vi.fn(async () => undefined),
    };
    const runner = new WatcherRunner(
      'STOCKS',
      pipeline,
      store,
      async () => [
        {
          source: { id: 'SEC', fetch: secMu },
          target: 'MU',
          targetKey: 'MU',
          config: {},
        },
        {
          source: { id: 'NEWS', fetch: newsMu },
          target: 'MU',
          targetKey: 'MU',
          config: {},
        },
        {
          source: { id: 'SEC', fetch: secXyz },
          target: 'XYZ',
          targetKey: 'XYZ',
          config: {},
        },
      ],
      notify,
      undefined,
      afterRun,
    );

    await runner.execute('config', 1n, 'SCHEDULED', {
      targetKeys: new Set(['MU']),
      sourceIds: new Set(['SEC']),
    });

    expect(secMu).toHaveBeenCalledOnce();
    expect(newsMu).not.toHaveBeenCalled();
    expect(secXyz).not.toHaveBeenCalled();
    expect(afterRun).toHaveBeenCalledOnce();
    expect(afterRun).toHaveBeenCalledWith(
      1n,
      expect.objectContaining({ fetchedCount: 0 }),
      'run',
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it('keeps scheduled source-only failures silent when no new content was found', async () => {
    const notify = vi.fn(async () => undefined);
    const store = {
      claimRun: vi.fn(async () => ({ id: 'scheduled-run' })),
      finishRun: vi.fn(async () => undefined),
      recordSourceFailures: vi.fn(async () => undefined),
    };
    const runner = new WatcherRunner(
      'STOCKS',
      new WatcherPipeline(
        {
          prepareItemsForRun: vi.fn(async () => []),
          saveAnalysis: vi.fn(async () => undefined),
        },
        { analyze: vi.fn() },
      ),
      store,
      async () => [
        {
          source: {
            id: 'NEWS',
            fetch: vi.fn(async () => {
              throw new Error('RATE_LIMITED provider backoff active');
            }),
          },
          target: 'GRNQ',
          config: {},
        },
      ],
      notify,
    );

    await expect(
      runner.execute('config', 1n, 'SCHEDULED'),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
      result: {
        newItemCount: 0,
        sourceFailures: [
          expect.objectContaining({ source: 'NEWS', target: 'GRNQ' }),
        ],
      },
    });

    expect(notify).not.toHaveBeenCalled();
    expect(store.finishRun).toHaveBeenCalledWith(
      'config',
      'scheduled-run',
      expect.objectContaining({ status: 'PARTIAL', newItemCount: 0 }),
    );
  });

  it('reports fatal watcher failures to the lifecycle observer', async () => {
    const afterFailure = vi.fn(async () => undefined);
    const store = {
      claimRun: vi.fn(async () => ({ id: 'failed-run' })),
      finishRun: vi.fn(async () => undefined),
      recordSourceFailures: vi.fn(async () => undefined),
    };
    const runner = new WatcherRunner(
      'PUBLICATIONS',
      new WatcherPipeline(
        {
          prepareItemsForRun: vi.fn(async () => {
            throw new Error('database unavailable');
          }),
          saveAnalysis: vi.fn(async () => undefined),
        },
        { analyze: vi.fn() },
      ),
      store,
      async () => [
        {
          source: { id: 'PUBMED', fetch: vi.fn(async () => []) },
          target: 'query',
          config: {},
        },
      ],
      vi.fn(),
      undefined,
      undefined,
      afterFailure,
    );

    await expect(runner.execute('config', 1n, 'SCHEDULED')).resolves.toEqual(
      expect.objectContaining({
        status: 'FAILED',
        error: 'database unavailable',
      }),
    );
    expect(afterFailure).toHaveBeenCalledWith(
      1n,
      'database unavailable',
      'failed-run',
    );
  });
});
