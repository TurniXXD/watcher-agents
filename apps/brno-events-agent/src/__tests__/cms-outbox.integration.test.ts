import { createDatabaseClient } from '@watcher/database';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CmsOutboxRepository } from '../cms/outbox-repository.js';
import type { EventSource, RawEvent } from '../domain/types.js';
import { EventRepository } from '../repositories/event-repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('Brno events CMS outbox', () => {
  if (!databaseUrl) return;
  const database = createDatabaseClient(databaseUrl);
  const outbox = new CmsOutboxRepository(database);
  const repository = new EventRepository(database, outbox);
  const source: EventSource = {
    id: 'cms-test-source',
    name: 'CMS test source',
    url: 'https://events.example.test',
    intervalMinutes: 60,
    enabled: true,
    fetchUpcomingEvents: async () => [],
  };
  const event: RawEvent = {
    externalId: 'cms-1',
    title: 'Outbox meetup',
    startAt: new Date('2027-01-20T16:00:00.000Z'),
    venue: { name: 'JIC' },
    eventUrl: 'https://events.example.test/cms-1',
    categories: ['ai'],
    recurring: false,
    cancelled: false,
  };

  beforeEach(async () => {
    await database.brnoEventCmsSync.deleteMany();
    await database.brnoEventSourceLink.deleteMany();
    await database.brnoEvent.deleteMany();
  });
  afterAll(async () => database.$disconnect());

  it('queues new events durably and does not re-queue unchanged sightings', async () => {
    const t0 = new Date('2026-11-06T10:00:00Z');
    expect(await repository.save(source, event, t0)).toBe('created');
    const [row] = await outbox.due(10, t0);
    expect(row).toMatchObject({ attempts: 0, syncedHash: null });
    await outbox.markSynced(row!.eventId, 'hash-1', 'cms-1', t0);

    expect(
      await repository.save(source, event, new Date('2026-11-06T11:00:00Z')),
    ).toBe('duplicate');
    expect(await outbox.due(10, new Date('2026-11-06T11:00:00Z'))).toEqual([]);

    // Daily re-confirmation keeps lastVerifiedAt fresh in the CMS.
    await repository.save(source, event, new Date('2026-11-07T08:00:00Z'));
    expect(await outbox.due(10, new Date('2026-11-07T08:00:00Z'))).toHaveLength(
      1,
    );
  });

  it('re-queues changed events with a fresh retry budget and survives terminal failures', async () => {
    const t0 = new Date('2026-11-06T10:00:00Z');
    await repository.save(source, event, t0);
    const [row] = await outbox.due(10, t0);
    await outbox.markAttemptFailed(
      row!.eventId,
      'CMS unreachable',
      { terminal: true },
      t0,
    );
    expect((await outbox.counts()).FAILED).toBe(1);

    expect(
      await repository.save(
        source,
        { ...event, title: 'Outbox meetup (moved)' },
        t0,
      ),
    ).toBe('updated');
    const [requeued] = await outbox.due(10, t0);
    expect(requeued).toMatchObject({ eventId: row!.eventId, attempts: 0 });
    expect(await outbox.retryFailed(t0)).toBe(0);
  });

  it('backfills events stored before the integration existed', async () => {
    const t0 = new Date('2026-11-06T10:00:00Z');
    await new EventRepository(database).save(source, event, t0);
    expect(await outbox.due(10, t0)).toEqual([]);
    await repository.save(source, event, new Date('2026-11-06T10:30:00Z'));
    expect(await outbox.due(10, new Date('2026-11-06T10:30:00Z'))).toHaveLength(
      1,
    );
  });
});
