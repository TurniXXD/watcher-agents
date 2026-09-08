import { describe, expect, it } from 'vitest';
import { parseCzechDate, parseCzechDateRange } from '../domain/czech-date.js';
import { canonicalUrl, eventFingerprint } from '../domain/normalization.js';
import { scoreEvent } from '../services/relevance.js';
import { parseJsonLdEvents } from '../sources/json-ld.js';
import type { RawEvent } from '../domain/types.js';
import { inferCategories } from '../domain/categorization.js';

const event: RawEvent = {
  title: 'CEITEC seminar about CRISPR genome editing',
  startAt: new Date('2026-09-10T16:00:00+02:00'),
  eventUrl: 'https://example.test/e/1',
  categories: ['biology', 'biotech', 'lecture'],
  recurring: false,
  cancelled: false,
};
describe('Brno events domain', () => {
  it('parses Czech numeric, named, and relative dates', () => {
    expect(parseCzechDate('8. září 2026 18:30')?.getHours()).toBe(18);
    expect(parseCzechDate('8. 9. 2026')?.getMonth()).toBe(8);
    expect(parseCzechDate('zítra 09:15', new Date(2026, 8, 8))?.getDate()).toBe(
      9,
    );
    expect(parseCzechDateRange('8.–10. 9. 2026')).toMatchObject({
      start: new Date(2026, 8, 8),
      end: new Date(2026, 8, 10, 23, 59, 59, 999),
    });
  });
  it('canonicalizes tracking URLs and creates stable fingerprints', () => {
    expect(canonicalUrl('https://x.test/a/?utm_source=y#z')).toBe(
      'https://x.test/a',
    );
    expect(eventFingerprint(event)).toBe(
      eventFingerprint({
        ...event,
        title: '  CEITEC seminar about CRISPR genome editing ',
      }),
    );
  });
  it('scores high-interest science events explainably', () => {
    const result = scoreEvent(event, new Date('2026-09-08T00:00:00Z'));
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.reasons).toContain('biology/biomedicine interest');
  });
  it('infers deterministic categories from Czech and English text', () => {
    expect(
      inferCategories('Praktický AI workshop pro Python vývojáře'),
    ).toEqual(expect.arrayContaining(['ai', 'programming', 'workshop']));
    expect(inferCategories('Nesouvisející událost')).toEqual(['other']);
  });
  it('parses Event JSON-LD and ignores malformed scripts', () => {
    const html = `<script type="application/ld+json">not json</script><script type="application/ld+json">{"@type":"Event","@id":"one","name":"AI Meetup Brno","startDate":"2026-09-10T18:00:00+02:00","url":"/events/one","location":{"name":"JIC","address":{"streetAddress":"Purkyňova 127","addressLocality":"Brno"}}}</script>`;
    const parsed = parseJsonLdEvents(html, 'https://example.test/list', ['ai']);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      title: 'AI Meetup Brno',
      eventUrl: 'https://example.test/events/one',
      venue: { name: 'JIC' },
    });
  });
});
