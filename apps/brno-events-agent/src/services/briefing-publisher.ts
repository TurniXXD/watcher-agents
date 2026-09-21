import { createHash } from 'node:crypto';
import type { BriefingEvent, BriefingEventRepository } from '@watcher/core';
import type { RawEvent } from '../domain/types.js';
import { isPlaceholderEventTitle } from '../domain/normalization.js';
import { scoreEvent } from './relevance.js';
import type {
  BrnoEventMessageType,
  BrnoEventPublisher,
} from './event-publisher.js';

const eventIdentity = (sourceId: string, event: RawEvent): string =>
  createHash('sha256')
    .update(`${sourceId}\0${event.externalId ?? event.eventUrl}`)
    .digest('hex');

const summaryFor = (event: RawEvent): string =>
  event.description?.trim().slice(0, 10_000) ||
  [
    `Brno event on ${event.startAt.toISOString()}.`,
    event.venue?.name ? `Venue: ${event.venue.name}.` : '',
    event.organizer?.name ? `Organizer: ${event.organizer.name}.` : '',
  ]
    .filter(Boolean)
    .join(' ');

export const brnoBriefingEvent = (
  type: Extract<
    BrnoEventMessageType,
    'event.high_relevance' | 'event.cancelled'
  >,
  event: RawEvent,
  sourceId: string,
  now = new Date(),
): BriefingEvent => {
  const score = scoreEvent(event, now).score;
  const id = eventIdentity(sourceId, event);
  const actionable = Boolean(
    event.registrationRequired || event.registrationUrl,
  );
  const deadlineUrgency = event.registrationDeadline
    ? Math.max(
        0,
        100 -
          (Math.max(0, event.registrationDeadline.getTime() - now.getTime()) /
            86_400_000) *
            12,
      )
    : 0;
  const timestamp = now.toISOString();
  return {
    id: `brno-events:${id}`,
    watcherBot: 'brno-events',
    externalEventId: id,
    occurredAt: event.startAt.toISOString(),
    detectedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    category:
      type === 'event.cancelled' ? 'BRNO_EVENT_CANCELLED' : 'BRNO_EVENT',
    subcategory: sourceId,
    title: event.title.slice(0, 500),
    summary: summaryFor(event),
    importance: type === 'event.cancelled' ? 90 : score,
    novelty: 100,
    relevance: score,
    urgency:
      type === 'event.cancelled'
        ? 100
        : Math.max(deadlineUrgency, event.startAt <= now ? 100 : 55),
    actionable,
    ...(actionable
      ? {
          action: event.registrationDeadline
            ? `Register by ${event.registrationDeadline.toISOString()}`
            : 'Review registration details',
        }
      : {}),
    entities: [
      ...(event.organizer?.name
        ? [{ type: 'organizer', name: event.organizer.name }]
        : []),
      ...(event.venue?.name ? [{ type: 'venue', name: event.venue.name }] : []),
    ],
    tags: ['BRNO_EVENTS', sourceId, ...event.categories],
    sourceUrls: [event.eventUrl],
    primarySource: sourceId,
    confidence: score >= 85 ? 'HIGH' : 'MEDIUM',
    status: 'NEW',
    deduplicationKey: `brno-events:${id}`,
    relatedEventIds: [],
    metadata: {
      sourceId,
      relevanceReasons: scoreEvent(event, now).reasons,
      ...(event.venue?.address ? { venueAddress: event.venue.address } : {}),
      ...(event.registrationUrl
        ? { registrationUrl: event.registrationUrl }
        : {}),
      ...(event.registrationDeadline
        ? { registrationDeadline: event.registrationDeadline.toISOString() }
        : {}),
    },
  };
};

export class BriefingBrnoEventPublisher implements BrnoEventPublisher {
  public constructor(private readonly events: BriefingEventRepository) {}

  public async publish(
    type: BrnoEventMessageType,
    event: RawEvent,
    sourceId: string,
  ): Promise<void> {
    if (type !== 'event.high_relevance' && type !== 'event.cancelled') return;
    if (isPlaceholderEventTitle(event.title)) return;
    const briefingEvent = brnoBriefingEvent(type, event, sourceId);
    if (type === 'event.high_relevance') {
      const existing = await this.events.list({
        watcherBots: ['brno-events'],
        limit: 1_000,
      });
      if (existing.some(({ id }) => id === briefingEvent.id)) return;
    }
    await this.events.save(briefingEvent);
  }
}
