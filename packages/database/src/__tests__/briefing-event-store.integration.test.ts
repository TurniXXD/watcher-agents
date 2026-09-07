import type { BriefingEvent, WatcherLogger } from '@watcher/core';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgresBriefingEventRepository } from '../briefing-event-store.js';
import { createDatabaseClient } from '../client.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

const event = (overrides: Partial<BriefingEvent> = {}): BriefingEvent => ({
  id: 'stocks:event-1',
  watcherBot: 'stocks',
  externalEventId: 'event-1',
  detectedAt: '2026-09-05T06:06:00.000Z',
  createdAt: '2026-09-05T06:06:00.000Z',
  updatedAt: '2026-09-05T06:06:00.000Z',
  category: 'STOCK_CATALYST',
  title: 'Material catalyst',
  summary: 'A material catalyst changed the monitored company thesis.',
  importance: 90,
  novelty: 100,
  relevance: 85,
  urgency: 75,
  actionable: true,
  action: 'Review before market open',
  entities: [{ type: 'company', name: 'Example Corp', ticker: 'EXM' }],
  tags: ['clinical'],
  sourceUrls: ['https://example.com/event/1'],
  primarySource: 'SEC',
  confidence: 'HIGH',
  status: 'NEW',
  deduplicationKey: 'EXM:clinical:event-1',
  relatedEventIds: [],
  metadata: { studyPhase: 3 },
  ...overrides,
});

integration('PostgresBriefingEventRepository', () => {
  if (!databaseUrl) return;

  const database = createDatabaseClient(databaseUrl);
  const warn = vi.fn<(details: unknown, message: string) => void>();
  const logger = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn,
  } as unknown as WatcherLogger;
  const repository = new PostgresBriefingEventRepository(database, logger);

  beforeEach(async () => {
    await database.briefingEvent.deleteMany();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await database.$disconnect();
  });

  it('persists and reads a validated event window', async () => {
    const saved = await repository.save(event());
    const listed = await repository.list({
      watcherBots: ['stocks'],
      detectedAfter: new Date('2026-09-05T06:00:00.000Z'),
      detectedThrough: new Date('2026-09-05T07:00:00.000Z'),
    });

    expect(saved.created).toBe(true);
    expect(listed).toEqual([saved.event]);
  });

  it('can read the newest detected events first before applying the limit', async () => {
    await repository.save(
      event({
        id: 'stocks:old',
        externalEventId: 'old',
        deduplicationKey: 'stocks:old',
      }),
    );
    await repository.save(
      event({
        id: 'stocks:new',
        externalEventId: 'new',
        deduplicationKey: 'stocks:new',
        detectedAt: '2026-09-05T06:30:00.000Z',
        createdAt: '2026-09-05T06:30:00.000Z',
        updatedAt: '2026-09-05T06:30:00.000Z',
        title: 'Newer material catalyst',
      }),
    );

    const listed = await repository.list({
      watcherBots: ['stocks'],
      detectedAfter: new Date('2026-09-05T06:00:00.000Z'),
      detectedThrough: new Date('2026-09-05T07:00:00.000Z'),
      detectedOrder: 'desc',
      limit: 1,
    });

    expect(listed.map(({ id }) => id)).toEqual(['stocks:new']);
  });

  it('uses producer identity keys idempotently and keeps the canonical id', async () => {
    await repository.save(event());
    const updated = await repository.save(
      event({
        id: 'stocks:a-second-delivery-id',
        title: 'Developing catalyst',
        status: 'DEVELOPING',
        updatedAt: '2026-09-05T06:10:00.000Z',
      }),
    );

    expect(updated).toMatchObject({
      created: false,
      event: {
        id: 'stocks:event-1',
        title: 'Developing catalyst',
        status: 'DEVELOPING',
      },
    });
    expect(await database.briefingEvent.count()).toBe(1);
  });

  it('does not let a stale delivery overwrite a newer event', async () => {
    await repository.save(
      event({
        title: 'Newest title',
        updatedAt: '2026-09-05T06:20:00.000Z',
      }),
    );
    const stale = await repository.save(event({ title: 'Stale title' }));

    expect(stale.event.title).toBe('Newest title');
  });

  it('rejects and logs malformed producer events', async () => {
    await expect(
      repository.save({ ...event(), importance: 101 }),
    ).rejects.toThrow();
    expect(warn).toHaveBeenCalledOnce();
    const [details, message] = warn.mock.calls[0]!;
    expect(message).toBe('Rejected malformed briefing event');
    expect(details).toHaveProperty('issues');
    expect(Array.isArray((details as { issues?: unknown }).issues)).toBe(true);
    expect(await database.briefingEvent.count()).toBe(0);
  });
});
