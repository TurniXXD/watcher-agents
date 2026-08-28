import type { WatchItem } from '@watcher/core';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabaseClient } from '../client.js';
import { WatcherStore } from '../store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

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

  it('uses a database constraint to reserve an item only once', async () => {
    const item: WatchItem = {
      id: 'SEC:0001',
      source: 'SEC',
      externalId: '0001',
      title: 'Filing',
      url: 'https://www.sec.gov/Archives/example',
      content: 'New filing content',
      metadata: {},
    };

    expect(await store.reserveNewItems('STOCKS', [item])).toHaveLength(1);
    expect(await store.reserveNewItems('STOCKS', [item])).toHaveLength(0);
  });

  it('atomically rejects a second overlapping run', async () => {
    const chat = await store.ensureChat('STOCKS', 123n);
    const configId = chat.watcherConfig!.id;

    expect(await store.claimRun(configId, 'MANUAL')).toBeDefined();
    expect(await store.claimRun(configId, 'SCHEDULED')).toBeUndefined();
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
