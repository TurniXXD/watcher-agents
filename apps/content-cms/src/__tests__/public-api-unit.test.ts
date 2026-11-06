import { describe, expect, it } from 'vitest';
import { publicMediaUrl, toPublicEvent } from '../public-api/dto';
import {
  buildEventsWhere,
  cursorWhere,
  QueryInputError,
} from '../public-api/query';
import { eventsQuerySchema, publicEventSchema } from '../public-api/schemas';
import { textToLexical } from '../lib/lexical';

const now = new Date('2026-11-06T12:00:00Z');
const stringify = (value: unknown) => JSON.stringify(value);

describe('events query builder', () => {
  it('defaults to published, approved, upcoming Brno events', () => {
    const where = stringify(
      buildEventsWhere(eventsQuerySchema.parse({}), now, 48),
    );
    expect(where).toContain('"_status":{"equals":"published"}');
    expect(where).toContain('"reviewStatus":{"equals":"approved"}');
    expect(where).toContain('"citySlug":{"equals":"brno"}');
    expect(where).toContain(
      '"startsAt":{"greater_than_equal":"2026-11-06T12:00:00.000Z"}',
    );
    expect(where).toContain(
      '"criticalUpdatePendingSince":{"greater_than":"2026-11-04T12:00:00.000Z"}',
    );
  });

  it('maps boolean filters and keeps free admission separate from free food', () => {
    const query = eventsQuerySchema.parse({
      freeFood: 'true',
      free: 'false',
      city: 'all',
    });
    const where = stringify(buildEventsWhere(query, now, 48));
    expect(where).toContain('"freeFood":{"equals":"yes"}');
    expect(where).toContain('"isFree":{"equals":false}');
    expect(where).not.toContain('citySlug');
  });

  it('rejects invalid ranges and cursors', () => {
    expect(() =>
      buildEventsWhere(
        eventsQuerySchema.parse({ from: '2026-11-10', to: '2026-11-01' }),
        now,
        48,
      ),
    ).toThrow(QueryInputError);
    expect(() =>
      buildEventsWhere(eventsQuerySchema.parse({ cursor: 'abc' }), now, 48),
    ).toThrow(QueryInputError);
    expect(eventsQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(eventsQuerySchema.parse({}).limit).toBe(20);
  });

  it('builds keyset conditions in both directions', () => {
    expect(cursorWhere('startsAt', { s: 'startsAt', v: 'T', id: 'X' })).toEqual(
      {
        or: [
          { startsAt: { greater_than: 'T' } },
          {
            and: [{ startsAt: { equals: 'T' } }, { id: { greater_than: 'X' } }],
          },
        ],
      },
    );
    expect(
      stringify(
        cursorWhere('-updatedAt', { s: '-updatedAt', v: 'T', id: 'X' }),
      ),
    ).toContain('less_than');
  });
});

describe('public event DTO', () => {
  const doc = {
    id: 'e1',
    slug: 'talk-2026-11-20',
    title: 'Talk',
    summary: 'Short',
    description: textToLexical('<b>Hi</b>'),
    startsAt: '2026-11-20T17:00:00.000Z',
    timezone: 'Europe/Prague',
    city: 'Brno',
    category: 'ai',
    tags: ['ml'],
    sourceUrl: 'https://organiser.example.org/e/1',
    isFree: true,
    price: 0,
    freeFood: 'unknown',
    foodDetails: 'stale detail',
    eventStatus: 'cancelled',
    featured: true,
    updatedAt: '2026-11-06T08:00:00.000Z',
    foodEvidence: [{ text: 'internal' }],
    sourceExcerpt: 'internal',
    reviewNotes: 'internal',
  };

  it('returns a stable, validated DTO without internal fields', () => {
    const dto = toPublicEvent(doc, 'https://cms.example.test');
    expect(publicEventSchema.parse(dto)).toEqual(dto);
    expect(dto).toMatchObject({
      description: '<b>Hi</b>',
      status: 'cancelled',
      foodDetails: null,
      imageUrl: null,
      endsAt: null,
    });
    expect(Object.keys(dto)).not.toEqual(
      expect.arrayContaining(['foodEvidence', 'sourceExcerpt', 'reviewNotes']),
    );
  });

  it('exposes only public media with publication rights', () => {
    const media = {
      url: '/api/media/file/a.jpg',
      visibility: 'public',
      usageRights: 'owned',
      sizes: { card: { url: '/api/media/file/a-1024.jpg' } },
    };
    expect(publicMediaUrl(media, 'https://cms.example.test', 'card')).toBe(
      'https://cms.example.test/api/media/file/a-1024.jpg',
    );
    expect(
      publicMediaUrl(
        { ...media, usageRights: 'unknown' },
        'https://cms.example.test',
      ),
    ).toBeNull();
    expect(
      publicMediaUrl(
        { ...media, visibility: 'private' },
        'https://cms.example.test',
      ),
    ).toBeNull();
    expect(
      publicMediaUrl('a-relationship-id', 'https://cms.example.test'),
    ).toBeNull();
  });
});
