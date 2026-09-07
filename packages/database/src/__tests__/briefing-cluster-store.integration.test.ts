import type { BriefingEvent } from '@watcher/core';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { BriefingStoryClusterStore } from '../briefing-cluster-store.js';
import { PostgresBriefingEventRepository } from '../briefing-event-store.js';
import { createDatabaseClient } from '../client.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

const event = (id: string): BriefingEvent => ({
  id,
  watcherBot: 'stocks',
  externalEventId: id,
  detectedAt: '2026-09-06T05:00:00.000Z',
  createdAt: '2026-09-06T05:00:00.000Z',
  updatedAt: '2026-09-06T05:00:00.000Z',
  category: 'STOCK_CATALYST',
  title: 'Material company catalyst',
  summary: 'A material catalyst changed the company outlook.',
  importance: 90,
  novelty: 90,
  relevance: 85,
  urgency: 70,
  actionable: true,
  action: 'Review before market open',
  entities: [{ type: 'company', name: 'Micron', ticker: 'MU' }],
  tags: ['catalyst'],
  sourceUrls: [`https://example.com/${id}`],
  confidence: 'HIGH',
  status: 'NEW',
});

integration('BriefingStoryClusterStore', () => {
  if (!databaseUrl) return;

  const database = createDatabaseClient(databaseUrl);
  const events = new PostgresBriefingEventRepository(database);
  const clusters = new BriefingStoryClusterStore(database);

  beforeEach(async () => {
    await database.briefingStoryClusterEvent.deleteMany();
    await database.briefingStoryCluster.deleteMany();
    await database.briefingEvent.deleteMany();
  });

  afterAll(async () => {
    await database.$disconnect();
  });

  it('persists one canonical cluster and its event membership', async () => {
    await events.save(event('event-1'));
    await events.save(event('event-2'));
    const base = {
      title: 'Material company catalyst',
      summary: 'A material catalyst changed the company outlook.',
      status: 'NEW',
      importance: 90,
      novelty: 90,
      relevance: 85,
      urgency: 70,
      actionable: true,
      actionItems: ['Review before market open'],
      watcherBots: ['stocks'],
      entities: [{ type: 'company', name: 'Micron', ticker: 'MU' }],
      sourceUrls: ['https://example.com/event-1'],
      firstEventAt: new Date('2026-09-06T05:00:00.000Z'),
      lastEventAt: new Date('2026-09-06T05:00:00.000Z'),
    } as const;

    const first = await clusters.save({
      ...base,
      id: 'story-one',
      eventIds: ['event-1'],
    });
    const expanded = await clusters.save({
      ...base,
      id: 'different-proposed-id',
      eventIds: ['event-1', 'event-2'],
      status: 'DEVELOPING',
      lastEventAt: new Date('2026-09-06T06:00:00.000Z'),
    });

    expect(first.id).toBe('story-one');
    expect(expanded).toMatchObject({
      id: 'story-one',
      eventIds: ['event-1', 'event-2'],
      status: 'DEVELOPING',
      firstEventAt: '2026-09-06T05:00:00.000Z',
      lastEventAt: '2026-09-06T06:00:00.000Z',
    });
    await expect(clusters.findIdByEventIds(['event-2'])).resolves.toBe(
      'story-one',
    );
  });

  it('rejects references to events that do not exist', async () => {
    await expect(
      clusters.save({
        id: 'invalid-story',
        eventIds: ['missing-event'],
        title: 'Missing',
        summary: 'This cluster references a missing event.',
        status: 'NEW',
        importance: 50,
        novelty: 50,
        relevance: 50,
        urgency: 50,
        actionable: false,
        actionItems: [],
        watcherBots: ['stocks'],
        entities: [],
        sourceUrls: [],
        firstEventAt: new Date('2026-09-06T05:00:00.000Z'),
        lastEventAt: new Date('2026-09-06T05:00:00.000Z'),
      }),
    ).rejects.toThrow(/unknown briefing event/);
  });

  it('stores embeddings and finds recent semantically similar event pairs', async () => {
    await events.save(event('vector-event-1'));
    await events.save(event('vector-event-2'));
    await clusters.saveEmbedding({
      eventId: 'vector-event-1',
      model: 'test-embedding',
      inputHash: 'a'.repeat(64),
      embedding: [1, 0, 0],
    });
    await clusters.saveEmbedding({
      eventId: 'vector-event-2',
      model: 'test-embedding',
      inputHash: 'b'.repeat(64),
      embedding: [0.99, 0.01, 0],
    });

    await expect(
      clusters.listEmbeddingStates(['vector-event-1', 'vector-event-2']),
    ).resolves.toHaveLength(2);
    await expect(
      clusters.findSemanticPairs({
        eventIds: ['vector-event-1', 'vector-event-2'],
        model: 'test-embedding',
        minimumSimilarity: 0.9,
        windowHours: 96,
      }),
    ).resolves.toMatchObject([
      {
        leftEventId: 'vector-event-1',
        rightEventId: 'vector-event-2',
      },
    ]);
  });
});
