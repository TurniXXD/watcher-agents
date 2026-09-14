import type { BriefingEventRepository } from '@watcher/core';
import { describe, expect, it, vi } from 'vitest';
import {
  BriefingBrnoEventPublisher,
  brnoBriefingEvent,
} from '../services/briefing-publisher.js';

const event = {
  externalId: 'event-1',
  title: 'Brno AI research meetup',
  description: 'A practical AI and machine-learning meetup in Brno.',
  startAt: new Date('2026-09-20T16:00:00.000Z'),
  eventUrl: 'https://example.com/events/ai',
  categories: ['ai' as const],
  recurring: false,
  cancelled: false,
};

describe('Brno briefing publisher', () => {
  it('turns a high-relevance event into a valid briefing event', () => {
    const briefingEvent = brnoBriefingEvent(
      'event.high_relevance',
      event,
      'meetup',
      new Date('2026-09-14T10:00:00.000Z'),
    );

    expect(briefingEvent).toMatchObject({
      watcherBot: 'brno-events',
      category: 'BRNO_EVENT',
      actionable: false,
    });
    expect(briefingEvent.relevance).toBeGreaterThan(0);
  });

  it('publishes only high-relevance or cancellation updates', async () => {
    const save = vi.fn(async () => ({ event: {}, created: true }));
    const publisher = new BriefingBrnoEventPublisher({
      save,
      list: vi.fn(async () => []),
    } as unknown as BriefingEventRepository);

    await publisher.publish('event.discovered', event, 'meetup');
    await publisher.publish('event.high_relevance', event, 'meetup');

    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ watcherBot: 'brno-events' }),
    );
  });

  it('does not replay a high-relevance event already in the briefing stream', async () => {
    const candidate = brnoBriefingEvent(
      'event.high_relevance',
      event,
      'meetup',
    );
    const save = vi.fn(async () => ({ event: {}, created: true }));
    const publisher = new BriefingBrnoEventPublisher({
      save,
      list: vi.fn(async () => [candidate]),
    } as unknown as BriefingEventRepository);

    await publisher.publish('event.high_relevance', event, 'meetup');

    expect(save).not.toHaveBeenCalled();
  });
});
