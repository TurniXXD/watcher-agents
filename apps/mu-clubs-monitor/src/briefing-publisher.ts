import { createHash } from 'node:crypto';
import type {
  BriefingEvent,
  BriefingEventRepository,
  WatcherLogger,
} from '@watcher/core';

type SavedActivity = {
  id: string;
  externalItemId: string;
  type: string;
  title: string;
  summary: string;
  sourceUrl: string;
  publishedAt: Date | null;
  startAt: Date | null;
  deadlineAt: Date | null;
  location: string | null;
  signupUrl: string | null;
  importance: number;
  confidence: number;
};

const identity = (activity: SavedActivity): string =>
  createHash('sha256').update(activity.id).digest('hex');

export const clubBriefingEvent = (
  club: { id: string; name: string; slug: string },
  activity: SavedActivity,
  now = new Date(),
): BriefingEvent => {
  const timestamp = now.toISOString();
  const eventId = identity(activity);
  const actionable = [
    'REGISTRATION_OPEN',
    'RECRUITMENT',
    'DEADLINE',
    'VOLUNTEER_OPPORTUNITY',
  ].includes(activity.type);
  const action = activity.deadlineAt
    ? `Act before ${activity.deadlineAt.toISOString()}`
    : activity.signupUrl
      ? 'Review the linked registration details'
      : undefined;
  return {
    id: `mu-clubs:${eventId}`,
    watcherBot: 'mu-clubs',
    externalEventId: eventId,
    ...(activity.startAt ? { occurredAt: activity.startAt.toISOString() } : {}),
    ...(activity.publishedAt
      ? { publishedAt: activity.publishedAt.toISOString() }
      : {}),
    detectedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    category: `CLUB_${activity.type}`,
    subcategory: club.slug,
    title: activity.title.slice(0, 500),
    summary: activity.summary.slice(0, 10_000),
    importance: activity.importance * 20,
    novelty: 100,
    relevance: Math.min(100, 50 + activity.importance * 10),
    urgency: activity.deadlineAt ? 90 : activity.startAt ? 70 : 40,
    actionable,
    ...(action ? { action } : {}),
    entities: [{ type: 'student_club', id: club.id, name: club.name }],
    tags: ['MU_CLUBS', activity.type, club.slug],
    sourceUrls: [activity.sourceUrl],
    primarySource: club.name,
    confidence:
      activity.confidence >= 0.8
        ? 'HIGH'
        : activity.confidence >= 0.5
          ? 'MEDIUM'
          : 'LOW',
    status: 'NEW',
    deduplicationKey: `mu-clubs:${eventId}`,
    relatedEventIds: [],
    metadata: {
      clubId: club.id,
      ...(activity.location ? { location: activity.location } : {}),
      ...(activity.signupUrl ? { signupUrl: activity.signupUrl } : {}),
      ...(activity.deadlineAt
        ? { deadlineAt: activity.deadlineAt.toISOString() }
        : {}),
    },
  };
};

export const publishClubBriefingEvents = async (
  repository: BriefingEventRepository,
  entries: ReadonlyArray<{
    club: { id: string; name: string; slug: string };
    activity: SavedActivity;
  }>,
  logger?: WatcherLogger,
  now = new Date(),
): Promise<{ published: number; failed: number }> => {
  const events = entries.map(({ club, activity }) =>
    clubBriefingEvent(club, activity, now),
  );
  const settled = await Promise.allSettled(
    events.map((event) => repository.save(event)),
  );
  settled.forEach((outcome, index) => {
    if (outcome.status === 'rejected')
      logger?.error(
        { briefingEventId: events[index]?.id, err: outcome.reason },
        'MU Clubs briefing event publication failed',
      );
  });
  return {
    published: settled.filter(({ status }) => status === 'fulfilled').length,
    failed: settled.filter(({ status }) => status === 'rejected').length,
  };
};
