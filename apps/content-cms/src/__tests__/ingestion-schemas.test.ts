import { describe, expect, it } from 'vitest';
import { eventAdapter, socialPostAdapter } from '../ingestion/adapters';
import {
  eventIngestItemSchema,
  socialPostIngestItemSchema,
} from '../ingestion/schemas';
import { lexicalToText } from '../lib/lexical';

const event = {
  externalId: 'brno-events-agent:123',
  title: 'Python workshop',
  startsAt: '2026-11-20T18:00:00+01:00',
  sourceUrl: 'https://organiser.example.org/e/1',
};

describe('event ingestion schema', () => {
  it('applies Brno defaults and normalises into editorial fields', () => {
    const item = eventIngestItemSchema.parse({
      ...event,
      category: 'Software Development',
      tags: ['Python', 'python'],
      descriptionText: 'Line one\n\nLine two',
    });
    expect(item).toMatchObject({
      city: 'Brno',
      timezone: 'Europe/Prague',
      freeFood: 'unknown',
      eventStatus: 'scheduled',
    });
    const managed = eventAdapter.toManaged(item);
    expect(managed).toMatchObject({
      startsAt: '2026-11-20T17:00:00.000Z',
      category: 'software-development',
      tags: ['python'],
      isFree: null,
      price: null,
    });
    expect(lexicalToText(managed.description)).toBe('Line one\n\nLine two');
    expect(eventAdapter.baseSlug(item)).toBe('python-workshop-2026-11-20');
  });

  it('records source images internally and never as publishable media', () => {
    const item = eventIngestItemSchema.parse({
      ...event,
      sourceImageUrl: 'https://organiser.example.org/poster.jpg',
    });
    expect(eventAdapter.toInternal(item).sourceImageUrl).toBe(
      'https://organiser.example.org/poster.jpg',
    );
    expect(eventAdapter.toManaged(item)).not.toHaveProperty('image');
  });

  it('requires evidence for yes/no free-food claims and treats free admission independently', () => {
    expect(
      eventIngestItemSchema.safeParse({ ...event, freeFood: 'yes' }).success,
    ).toBe(false);
    expect(
      eventIngestItemSchema.safeParse({ ...event, freeFood: 'no' }).success,
    ).toBe(false);
    expect(
      eventIngestItemSchema.safeParse({
        ...event,
        freeFood: 'yes',
        foodEvidence: [{ text: 'Free pizza provided' }],
      }).success,
    ).toBe(true);
    const freeAdmission = eventIngestItemSchema.parse({
      ...event,
      isFree: true,
    });
    expect(freeAdmission.freeFood).toBe('unknown');
    expect(eventAdapter.toManaged(freeAdmission)).toMatchObject({
      isFree: true,
      price: 0,
      freeFood: 'unknown',
    });
  });

  it('rejects inconsistent or unsafe input', () => {
    expect(
      eventIngestItemSchema.safeParse({
        ...event,
        endsAt: '2026-11-20T17:00:00+01:00',
      }).success,
    ).toBe(false);
    expect(
      eventIngestItemSchema.safeParse({ ...event, timezone: 'Mars/Olympus' })
        .success,
    ).toBe(false);
    expect(
      eventIngestItemSchema.safeParse({
        ...event,
        sourceUrl: 'javascript:alert(1)',
      }).success,
    ).toBe(false);
    expect(
      eventIngestItemSchema.safeParse({
        ...event,
        startsAt: '2026-11-20T18:00:00',
      }).success,
    ).toBe(false);
    expect(
      eventIngestItemSchema.safeParse({ ...event, price: 100 }).success,
    ).toBe(false);
    expect(
      eventIngestItemSchema.safeParse({ ...event, externalId: 'has space' })
        .success,
    ).toBe(false);
  });
});

describe('social post ingestion schema', () => {
  it('validates platform and post type combinations and strips hashtag markers', () => {
    const base = { externalId: 'p1', title: 'Post', content: 'Hello' };
    expect(
      socialPostIngestItemSchema.safeParse({
        ...base,
        platform: 'tiktok',
        postType: 'story',
      }).success,
    ).toBe(false);
    const item = socialPostIngestItemSchema.parse({
      ...base,
      platform: 'instagram',
      postType: 'reel',
      hashtags: ['#brno', 'ai'],
    });
    expect(socialPostAdapter.toManaged(item).hashtags).toEqual(['brno', 'ai']);
  });
});
