import { createDatabaseClient } from '@watcher/database';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { EventSource, RawEvent } from '../domain/types.js';
import { EventRepository } from '../repositories/event-repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('Brno event persistence', () => {
  if (!databaseUrl) return;
  const database = createDatabaseClient(databaseUrl);
  const repository = new EventRepository(database);
  const source: EventSource = {
    id: 'test-source',
    name: 'Test source',
    url: 'https://events.example.test',
    intervalMinutes: 60,
    enabled: true,
    fetchUpcomingEvents: async () => [],
  };
  const event: RawEvent = {
    externalId: 'event-1',
    title: 'AI Meetup Brno',
    description: 'A substantive AI engineering meetup.',
    startAt: new Date('2026-09-20T16:00:00.000Z'),
    venue: { name: 'JIC' },
    organizer: { name: 'Brno AI' },
    eventUrl: 'https://events.example.test/event-1?utm_source=test',
    categories: ['ai', 'networking'],
    recurring: false,
    cancelled: false,
  };

  beforeEach(async () => {
    await database.brnoEventSourceRun.deleteMany();
    await database.brnoEventSourceLink.deleteMany();
    await database.brnoEvent.deleteMany();
  });
  afterAll(async () => database.$disconnect());

  it('deduplicates unchanged events and records actual content updates', async () => {
    expect(await repository.save(source, event)).toBe('created');
    expect(
      await repository.save(source, {
        ...event,
        eventUrl: 'https://events.example.test/event-1#details',
      }),
    ).toBe('duplicate');
    expect(
      await repository.save(source, {
        ...event,
        description: 'Updated agenda for a substantive AI engineering meetup.',
      }),
    ).toBe('updated');
    expect(await database.brnoEvent.count()).toBe(1);
    expect(await database.brnoEventSourceLink.count()).toBe(1);
  });

  it('merges another source only with matching time and venue or organizer', async () => {
    await repository.save(source, event);
    const other = { ...source, id: 'other-source', name: 'Other source' };
    expect(
      await repository.save(other, {
        ...event,
        externalId: 'other-1',
        eventUrl: 'https://other.example.test/one',
        startAt: new Date('2026-09-20T16:15:00.000Z'),
      }),
    ).toBe('duplicate');
    expect(await database.brnoEvent.count()).toBe(1);
    expect(await database.brnoEventSourceLink.count()).toBe(2);

    await repository.save(other, {
      ...event,
      externalId: 'other-2',
      eventUrl: 'https://other.example.test/two',
      startAt: new Date('2026-09-20T18:00:00.000Z'),
    });
    expect(await database.brnoEvent.count()).toBe(2);
  });

  it('filters upcoming events by relevance, category, source, and price', async () => {
    await repository.save(source, { ...event, price: { free: true } });
    const rows = await repository.list({
      from: new Date('2026-09-20T00:00:00.000Z'),
      category: 'ai',
      source: source.id,
      free: true,
      minRelevance: 60,
      limit: 10,
      offset: 0,
    });
    expect(rows).toHaveLength(1);
  });
});
