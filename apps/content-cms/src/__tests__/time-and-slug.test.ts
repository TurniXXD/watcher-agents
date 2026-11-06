import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from '../lib/cursor';
import { lexicalToText, textToLexical } from '../lib/lexical';
import { sameValue } from '../lib/equality';
import { disambiguateSlug, eventSlug, isValidSlug, slugify } from '../lib/slug';
import {
  localDateString,
  resolveDateFilter,
  startOfLocalDay,
  zonedTimeToUtc,
} from '../lib/time';

const TZ = 'Europe/Prague';

describe('Europe/Prague time handling', () => {
  it('computes local midnight across DST boundaries', () => {
    expect(startOfLocalDay('2026-01-15', TZ).toISOString()).toBe(
      '2026-01-14T23:00:00.000Z',
    );
    expect(startOfLocalDay('2026-07-15', TZ).toISOString()).toBe(
      '2026-07-14T22:00:00.000Z',
    );
    // Spring forward (29 March 2026) and fall back (25 October 2026) days.
    expect(startOfLocalDay('2026-03-29', TZ).toISOString()).toBe(
      '2026-03-28T23:00:00.000Z',
    );
    expect(startOfLocalDay('2026-10-25', TZ).toISOString()).toBe(
      '2026-10-24T22:00:00.000Z',
    );
  });

  it('resolves non-existent and ambiguous wall-clock times deterministically', () => {
    const gap = zonedTimeToUtc(
      { year: 2026, month: 3, day: 29, hour: 2, minute: 30 },
      TZ,
    );
    expect(gap.toISOString()).toBe('2026-03-29T01:30:00.000Z');
    const ambiguous = zonedTimeToUtc(
      { year: 2026, month: 10, day: 25, hour: 2, minute: 30 },
      TZ,
    );
    expect(ambiguous.toISOString()).toBe('2026-10-25T00:30:00.000Z');
  });

  it('treats `to` dates as inclusive local days and requires offsets on timestamps', () => {
    expect(resolveDateFilter('2026-03-28', 'to', TZ)).toEqual({
      instant: new Date('2026-03-28T23:00:00.000Z'),
      exclusive: true,
    });
    expect(
      resolveDateFilter(
        '2026-11-20T10:00:00+01:00',
        'from',
        TZ,
      ).instant.toISOString(),
    ).toBe('2026-11-20T09:00:00.000Z');
    expect(() => resolveDateFilter('2026-11-20T10:00:00', 'from', TZ)).toThrow(
      RangeError,
    );
    expect(() => resolveDateFilter('2026-02-30', 'from', TZ)).toThrow(
      RangeError,
    );
  });

  it('formats local dates', () => {
    expect(localDateString(new Date('2026-11-30T23:30:00Z'), TZ)).toBe(
      '2026-12-01',
    );
  });
});

describe('slugs', () => {
  it('produces stable ASCII slugs from Czech titles', () => {
    expect(slugify('Přednáška: Úvod do AI & strojového učení')).toBe(
      'prednaska-uvod-do-ai-and-strojoveho-uceni',
    );
    expect(slugify('  --  ')).toBe('');
    expect(slugify('a'.repeat(200)).length).toBeLessThanOrEqual(80);
  });

  it('includes the Prague-local start date in event slugs', () => {
    expect(eventSlug('Night Talk', new Date('2026-11-30T23:30:00Z'))).toBe(
      'night-talk-2026-12-01',
    );
    expect(eventSlug('***', new Date('2026-11-30T10:00:00Z'))).toBe(
      'event-2026-11-30',
    );
  });

  it('disambiguates collisions deterministically per identity', () => {
    const first = disambiguateSlug('talk-2026-12-01', 'events:bot:1');
    expect(first).toBe(disambiguateSlug('talk-2026-12-01', 'events:bot:1'));
    expect(first).not.toBe(disambiguateSlug('talk-2026-12-01', 'events:bot:2'));
    expect(isValidSlug(first)).toBe(true);
  });
});

describe('cursor encoding', () => {
  it('round-trips and rejects tampering or a different sort', () => {
    const cursor = encodeCursor({
      s: 'startsAt',
      v: '2026-11-20T17:00:00.000Z',
      id: 'abc',
    });
    expect(decodeCursor(cursor, 'startsAt')).toEqual({
      s: 'startsAt',
      v: '2026-11-20T17:00:00.000Z',
      id: 'abc',
    });
    expect(decodeCursor(cursor, '-startsAt')).toBeNull();
    expect(decodeCursor('%%%', 'startsAt')).toBeNull();
    expect(
      decodeCursor(Buffer.from('{"s":1}').toString('base64url'), 'startsAt'),
    ).toBeNull();
  });
});

describe('rich text conversion', () => {
  it('round-trips paragraphs and line breaks as plain text', () => {
    const text = 'First paragraph\nsecond line\n\nSecond paragraph';
    expect(lexicalToText(textToLexical(text))).toBe(text);
    expect(lexicalToText(null)).toBeNull();
    expect(lexicalToText(textToLexical('   '))).toBeNull();
  });

  it('never emits markup, only text', () => {
    expect(lexicalToText(textToLexical('<script>alert(1)</script>'))).toBe(
      '<script>alert(1)</script>',
    );
  });
});

describe('value equality', () => {
  it('normalises dates, empty values, and key order', () => {
    expect(sameValue('2026-11-20T17:00:00Z', '2026-11-20T17:00:00.000Z')).toBe(
      true,
    );
    expect(sameValue('', null)).toBe(true);
    expect(sameValue([], null)).toBe(true);
    expect(sameValue({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(sameValue('a', 'b')).toBe(false);
  });
});
