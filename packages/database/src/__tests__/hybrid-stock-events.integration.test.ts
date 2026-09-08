import type { WatchItem } from '@watcher/core';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabaseClient } from '../client.js';
import { StockEventVectorStore } from '../stock-event-vector-store.js';
import { WatcherStore } from '../store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

const item = (
  externalId: string,
  ticker: string,
  title: string,
  content = title,
): WatchItem => ({
  id: `NEWS:${externalId}`,
  source: 'NEWS',
  externalId,
  title,
  url: `https://example.com/${externalId}`,
  content,
  sourceType: 'NEWS',
  publishedAt: new Date('2026-09-08T12:00:00Z'),
  metadata: { symbol: ticker },
});

integration('hybrid stock events with PostgreSQL and pgvector', () => {
  if (!databaseUrl) return;
  const database = createDatabaseClient(databaseUrl);

  beforeEach(async () => {
    await database.stockAlert.deleteMany();
    await database.thesisRevision.deleteMany();
    await database.companyThesisState.deleteMany();
    await database.eventObservation.deleteMany();
    await database.canonicalEvent.deleteMany();
    await database.eventChain.deleteMany();
    await database.analysisCooldown.deleteMany();
    await database.telegramChat.deleteMany();
    await database.processedItem.deleteMany();
    await database.domainEvent.deleteMany();
  });

  afterAll(async () => database.$disconnect());

  it('lets HIGH events bypass an exhausted ordinary analysis limit', async () => {
    const store = new WatcherStore(database);
    const chat = await store.ensureChat('STOCKS', 7001n);
    const run = await store.claimRun(chat.watcherConfig!.id, 'MANUAL');
    if (!run) throw new Error('Expected run');
    const prepared = await store.prepareItemsForRun(
      'STOCKS',
      run.id,
      [
        item('legal', 'MU', 'MU litigation settlement announced'),
        item('acquisition', 'NVDA', 'NVDA announces major acquisition'),
      ],
      1,
    );
    expect(prepared).toHaveLength(2);
    const high = await database.canonicalEvent.findFirstOrThrow({
      where: { ticker: 'NVDA' },
    });
    expect(high.materiality).toBe('HIGH');
    expect(high.analysisStatus).toBe('ANALYZING');
  });

  it('records failed HIGH analysis explicitly instead of silently skipping it', async () => {
    const store = new WatcherStore(database);
    const chat = await store.ensureChat('STOCKS', 7002n);
    const run = await store.claimRun(chat.watcherConfig!.id, 'MANUAL');
    if (!run) throw new Error('Expected run');
    const [prepared] = await store.prepareItemsForRun(
      'STOCKS',
      run.id,
      [item('nvda-ma', 'NVDA', 'NVDA announces acquisition of Hugging Face')],
      1,
    );
    if (!prepared) throw new Error('Expected analysis preparation');
    await store.saveAnalysis(run.id, prepared.recordId, {
      status: 'FAILED',
      error: 'model unavailable',
    });
    await expect(
      database.canonicalEvent.findFirstOrThrow({ where: { ticker: 'NVDA' } }),
    ).resolves.toMatchObject({
      materiality: 'HIGH',
      analysisStatus: 'FAILED',
      analysisError: 'model unavailable',
    });
    await expect(
      store.getRunIntelligenceSummary(run.id),
    ).resolves.toMatchObject({
      analysisFailed: 1,
      highImportanceAnalyzed: 0,
      highImportanceSkipped: 0,
    });
  });

  it('re-evaluates one clustered event after three independent sources', async () => {
    const store = new WatcherStore(database);
    const chat = await store.ensureChat('STOCKS', 7005n);
    const run = await store.claimRun(chat.watcherConfig!.id, 'MANUAL');
    if (!run) throw new Error('Expected run');
    const evidence = ['WIRE_A', 'WIRE_B', 'WIRE_C'].map((source, index) => ({
      ...item(
        `operating-update-${index}`,
        'MU',
        'MU discusses long-term operating priorities',
      ),
      id: `${source}:operating-update-${index}`,
      source,
      url: `https://example.com/${source.toLowerCase()}/operating-update`,
    }));

    const prepared = await store.prepareItemsForRun(
      'STOCKS',
      run.id,
      evidence,
      5,
    );

    expect(prepared).toHaveLength(1);
    expect(await database.canonicalEvent.count()).toBe(1);
    await expect(
      database.canonicalEvent.findFirstOrThrow(),
    ).resolves.toMatchObject({
      materiality: 'MEDIUM',
      analysisStatus: 'ANALYZING',
    });
    await expect(
      store.getRunIntelligenceSummary(run.id),
    ).resolves.toMatchObject({
      eventsCreated: 1,
      eventsUpdated: 1,
      eventsClustered: 2,
      events: [expect.objectContaining({ ticker: 'MU' })],
    });
  });

  it('falls back to deterministic clustering when embedding generation fails', async () => {
    const embed = vi.fn(async (): Promise<number[][]> => {
      throw new Error('embedding model unavailable');
    });
    const store = new WatcherStore(database, {
      stockEventSemantic: {
        model: 'nomic-embed-text',
        provider: { embed },
        minimumSimilarity: 0.8,
        windowHours: 96,
      },
    });
    const chat = await store.ensureChat('STOCKS', 7006n);
    const run = await store.claimRun(chat.watcherConfig!.id, 'MANUAL');
    if (!run) throw new Error('Expected run');

    await expect(
      store.prepareItemsForRun(
        'STOCKS',
        run.id,
        [
          item('aout-results-a', 'AOUT', 'AOUT reports quarterly results'),
          {
            ...item(
              'aout-results-b',
              'AOUT',
              'AOUT reports quarterly results and guidance',
            ),
            source: 'SECOND_WIRE',
          },
        ],
        5,
      ),
    ).resolves.toHaveLength(1);
    expect(await database.canonicalEvent.count()).toBe(1);
    expect(await database.eventObservation.count()).toBe(2);
    expect(embed).toHaveBeenCalledTimes(2);
    await expect(
      store.getRunIntelligenceSummary(run.id),
    ).resolves.toMatchObject({
      embeddingCalls: 2,
      semanticCandidatesChecked: 0,
      semanticClustersMatched: 0,
      embeddingFailures: 2,
    });
  });

  it('uses one shared embedding provider to cluster supported evidence', async () => {
    const embed = vi.fn(async () => [[0.2, 0.4, 0.8]]);
    const store = new WatcherStore(database, {
      stockEventSemantic: {
        model: 'nomic-embed-text',
        provider: { embed },
        minimumSimilarity: 0.8,
        windowHours: 96,
      },
    });
    const chat = await store.ensureChat('STOCKS', 7003n);
    const first = await store.claimRun(chat.watcherConfig!.id, 'MANUAL');
    if (!first) throw new Error('Expected first run');
    await store.prepareItemsForRun(
      'STOCKS',
      first.id,
      [item('aout-results', 'AOUT', 'AOUT reports quarterly results')],
      5,
    );
    await store.finishRun(chat.watcherConfig!.id, first.id, {
      status: 'SUCCESS',
    });
    const second = await store.claimRun(chat.watcherConfig!.id, 'MANUAL');
    if (!second) throw new Error('Expected second run');
    await store.prepareItemsForRun(
      'STOCKS',
      second.id,
      [
        item(
          'aout-guidance',
          'AOUT',
          'AOUT raises guidance after quarterly results',
        ),
      ],
      5,
    );
    expect(await database.canonicalEvent.count()).toBe(1);
    const event = await database.canonicalEvent.findFirstOrThrow();
    expect(event.eventTypes).toEqual(
      expect.arrayContaining(['EARNINGS', 'GUIDANCE']),
    );
    expect(embed).toHaveBeenCalledTimes(2);
    await expect(
      store.getRunIntelligenceSummary(second.id),
    ).resolves.toMatchObject({
      embeddingCalls: 1,
      semanticCandidatesChecked: 1,
      semanticClustersMatched: 1,
      embeddingFailures: 0,
    });
  });

  it('retrieves semantically similar historical events', async () => {
    const embed = vi.fn(async () => [[0.1, 0.3, 0.9]]);
    const store = new WatcherStore(database, {
      stockEventSemantic: {
        model: 'nomic-embed-text',
        provider: { embed },
        minimumSimilarity: 0.8,
        windowHours: 96,
      },
    });
    const chat = await store.ensureChat('STOCKS', 7004n);
    for (const [id, ticker] of [
      ['mu-results', 'MU'],
      ['aout-results', 'AOUT'],
    ] as const) {
      const run = await store.claimRun(chat.watcherConfig!.id, 'MANUAL');
      if (!run) throw new Error('Expected run');
      await store.prepareItemsForRun(
        'STOCKS',
        run.id,
        [item(id, ticker, `${ticker} reports quarterly earnings results`)],
        5,
      );
      await store.finishRun(chat.watcherConfig!.id, run.id, {
        status: 'SUCCESS',
      });
    }
    const current = await database.canonicalEvent.findFirstOrThrow({
      where: { ticker: 'AOUT' },
    });
    const similar = await new StockEventVectorStore(
      database,
    ).findSimilarHistoricalEvents(current.id, 3);
    expect(similar[0]).toMatchObject({ ticker: 'MU', similarity: 1 });
  });
});
