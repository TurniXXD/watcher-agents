import {
  briefingEventSchema,
  type BriefingEventRepository,
} from '@watcher/core';
import { describe, expect, it, vi } from 'vitest';
import {
  clubBriefingEvent,
  publishClubBriefingEvents,
} from '../briefing-publisher.js';

const club = { id: 'ifmsa-brno', slug: 'ifmsa-brno', name: 'IFMSA CZ Brno' };
const activity = {
  id: 'activity-1',
  externalItemId: 'post-1',
  type: 'REGISTRATION_OPEN',
  title: 'Applications opened for a workshop',
  summary: 'Register by Wednesday.',
  sourceUrl: 'https://www.instagram.com/p/example/',
  publishedAt: new Date('2026-09-06T08:00:00Z'),
  startAt: new Date('2026-09-15T16:00:00Z'),
  deadlineAt: new Date('2026-09-12T10:00:00Z'),
  location: 'Brno',
  signupUrl: 'https://example.com/signup',
  importance: 5,
  confidence: 0.9,
};

describe('MU Clubs briefing publisher', () => {
  it('creates a valid actionable event on the mu-clubs subscription', () => {
    expect(
      briefingEventSchema.parse(
        clubBriefingEvent(club, activity, new Date('2026-09-07T06:00:00Z')),
      ),
    ).toMatchObject({
      watcherBot: 'mu-clubs',
      category: 'CLUB_REGISTRATION_OPEN',
      importance: 100,
      actionable: true,
      entities: [
        { type: 'student_club', id: 'ifmsa-brno', name: 'IFMSA CZ Brno' },
      ],
    });
  });

  it('isolates individual publication failures', async () => {
    const save = vi
      .fn()
      .mockResolvedValueOnce({ event: {}, created: true })
      .mockRejectedValueOnce(new Error('database failed'));
    const repository: BriefingEventRepository = { save, list: vi.fn() };
    expect(
      await publishClubBriefingEvents(repository, [
        { club, activity },
        { club, activity: { ...activity, id: 'activity-2' } },
      ]),
    ).toEqual({ published: 1, failed: 1 });
  });
});
