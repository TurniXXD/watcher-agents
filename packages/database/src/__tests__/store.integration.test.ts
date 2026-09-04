import type { WatchItem } from '@watcher/core';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabaseClient } from '../client.js';
import { WatcherStore } from '../store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

const watchItem = (externalId: string): WatchItem => ({
  id: `SEC:${externalId}`,
  source: 'SEC',
  externalId,
  title: 'Filing',
  url: 'https://www.sec.gov/Archives/example',
  content: 'New filing content',
  metadata: {},
});

integration('WatcherStore with PostgreSQL', () => {
  if (!databaseUrl) return;

  const database = createDatabaseClient(databaseUrl);
  const store = new WatcherStore(database);

  beforeEach(async () => {
    await database.telegramChat.deleteMany();
    await database.processedItem.deleteMany();
  });

  afterAll(async () => {
    await database.$disconnect();
  });

  it('uses a database constraint to prepare an item only once per watcher', async () => {
    const chat = await store.ensureChat('STOCKS', 123n);
    const firstRun = await store.claimRun(chat.watcherConfig!.id, 'MANUAL');
    if (!firstRun) throw new Error('Expected first run');
    const item = watchItem('0001');

    const prepared = await store.prepareItemsForRun(
      'STOCKS',
      firstRun.id,
      [item],
      5,
    );
    expect(prepared).toHaveLength(1);
    await store.saveAnalysis(firstRun.id, prepared[0]!.recordId, {
      status: 'SUCCESS',
      result: {
        title: 'Filing',
        summary: 'Summary',
        importance: 4,
        sentiment: 'neutral',
        eventType: '8-K',
        positives: [],
        negatives: [],
        risks: [],
        catalysts: [],
        confidence: 0.8,
      },
    });
    await store.finishRun(chat.watcherConfig!.id, firstRun.id, {
      status: 'SUCCESS',
    });

    const sameChatRun = await store.claimRun(chat.watcherConfig!.id, 'MANUAL');
    if (!sameChatRun) throw new Error('Expected same chat run');
    expect(
      await store.prepareItemsForRun('STOCKS', sameChatRun.id, [item], 5),
    ).toHaveLength(0);

    const secondChat = await store.ensureChat('STOCKS', 456n);
    const secondChatRun = await store.claimRun(
      secondChat.watcherConfig!.id,
      'MANUAL',
    );
    if (!secondChatRun) throw new Error('Expected second chat run');
    const reused = await store.prepareItemsForRun(
      'STOCKS',
      secondChatRun.id,
      [item],
      5,
    );
    expect(reused).toHaveLength(1);
    expect(reused[0]?.outcome?.status).toBe('SUCCESS');
  });

  it('treats zero max analyses as unlimited', async () => {
    const chat = await store.ensureChat('PUBLICATIONS', 321n);
    const run = await store.claimRun(chat.watcherConfig!.id, 'MANUAL');
    if (!run) throw new Error('Expected run');

    const prepared = await store.prepareItemsForRun(
      'PUBLICATIONS',
      run.id,
      [watchItem('pubmed-1'), watchItem('pubmed-2'), watchItem('pubmed-3')],
      0,
    );

    expect(prepared).toHaveLength(3);
  });

  it('atomically rejects a second overlapping run', async () => {
    const chat = await store.ensureChat('STOCKS', 123n);
    const configId = chat.watcherConfig!.id;

    expect(await store.claimRun(configId, 'MANUAL')).toBeDefined();
    expect(await store.claimRun(configId, 'SCHEDULED')).toBeUndefined();
  });

  it('adds missing source switches to existing stocks', async () => {
    const chat = await store.ensureChat('STOCKS', 123n);
    await database.stock.create({
      data: { chatConfigId: chat.id, symbol: 'MU' },
    });

    const [stock] = await store.listStocks(chat.id);

    expect(stock?.sources.map(({ source }) => source).sort()).toEqual(
      [
        'EARNINGS_WHISPERS',
        'FINVIZ',
        'INVESTOR_RELATIONS',
        'NEWS',
        'PRICE',
        'SEC',
        'ZACKS',
      ].sort(),
    );
    expect(stock?.sources.filter(({ enabled }) => enabled)).toHaveLength(0);
  });

  it('bulk-adds publication queries and skips duplicates', async () => {
    const chat = await store.ensureChat('PUBLICATIONS', 123n);

    const first = await store.addQueries(chat.id, [
      'mycorrhizal fungi',
      'plant microbiome',
      'MYCORRHIZAL FUNGI',
    ]);
    const second = await store.addQueries(chat.id, [
      'mycorrhizal fungi',
      'soil carbon',
    ]);
    const queries = await store.listQueries(chat.id);

    expect(first).toEqual({ addedCount: 2, skippedCount: 0, totalCount: 2 });
    expect(second).toEqual({ addedCount: 1, skippedCount: 1, totalCount: 2 });
    expect(queries.map((entry) => entry.query).sort()).toEqual([
      'mycorrhizal fungi',
      'plant microbiome',
      'soil carbon',
    ]);
    expect(
      queries.every(
        (entry) =>
          entry.sources.length === 4 &&
          entry.sources.every(({ enabled }) => enabled),
      ),
    ).toBe(true);
  });

  it('enables every publication source for a new single query', async () => {
    const chat = await store.ensureChat('PUBLICATIONS', 124n);

    const query = await store.addQuery(chat.id, 'soil microbiome');

    expect(query.sources).toHaveLength(4);
    expect(query.sources.every(({ enabled }) => enabled)).toBe(true);
  });

  it('serializes Ollama leases across database sessions', async () => {
    let release: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const order: string[] = [];
    const first = store.withOllamaLease(async () => {
      order.push('first-start');
      markStarted?.();
      await waiting;
      order.push('first-end');
    });
    await started;
    const second = store.withOllamaLease(async () => {
      order.push('second');
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(order).toEqual(['first-start']);
    release?.();
    await Promise.all([first, second]);
    expect(order).toEqual(['first-start', 'first-end', 'second']);
  });
});
