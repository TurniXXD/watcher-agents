import { describe, expect, it } from 'vitest';
import {
  HeuristicActivityClassifier,
  activityContentHash,
} from '../classifier.js';
import { parseCzechDate } from '../date-parser.js';

const candidate = {
  sourceId: 'club-instagram',
  externalItemId: 'abc',
  title: '📢 Nábor je tady!',
  content:
    'Přijď 15. 9. v 18:00 do Auly. Přihlášky do 12. 9. https://example.com/signup',
  sourceUrl: 'https://www.instagram.com/p/abc/',
};

describe('MU club activity classification', () => {
  it('extracts a meaningful activity, Czech dates, and signup link', () => {
    const activity = new HeuristicActivityClassifier().classify(
      candidate,
      new Date('2026-08-01T00:00:00.000Z'),
    );
    expect(activity).toMatchObject({
      relevant: true,
      type: 'REGISTRATION_OPEN',
      importance: 5,
      signupUrl: 'https://example.com/signup',
    });
    expect(activity.startAt?.toISOString()).toBe('2026-09-15T16:00:00.000Z');
    expect(activity.deadlineAt?.toISOString()).toBe('2026-09-12T10:00:00.000Z');
  });

  it('parses Czech named months and advances old undated dates to next year', () => {
    expect(
      parseCzechDate(
        '5. října v 19:30',
        new Date('2026-09-01T00:00:00Z'),
      )?.toISOString(),
    ).toBe('2026-10-05T17:30:00.000Z');
    expect(
      parseCzechDate(
        '5. ledna 18:00',
        new Date('2026-09-01T00:00:00Z'),
      )?.getUTCFullYear(),
    ).toBe(2027);
  });

  it('uses stable content hashes for cross-source deduplication', () => {
    expect(activityContentHash('club', candidate)).toBe(
      activityContentHash('club', {
        ...candidate,
        sourceId: 'other',
        externalItemId: 'elsewhere',
      }),
    );
  });
});
