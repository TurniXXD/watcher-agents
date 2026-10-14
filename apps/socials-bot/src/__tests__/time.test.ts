import { describe, expect, it } from 'vitest';
import {
  dateInTimezone,
  isoWeekRange,
  nextPlanningWeek,
  planDate,
} from '../time.js';

describe('social planning time', () => {
  it('keeps the requested Prague wall time across DST', () => {
    expect(
      dateInTimezone(
        { year: 2026, month: 3, day: 23, hour: 9, minute: 0 },
        'Europe/Prague',
      ).toISOString(),
    ).toBe('2026-03-23T08:00:00.000Z');
    expect(
      dateInTimezone(
        { year: 2026, month: 3, day: 30, hour: 9, minute: 0 },
        'Europe/Prague',
      ).toISOString(),
    ).toBe('2026-03-30T07:00:00.000Z');
  });

  it('uses the next ISO week when planning on Sunday', () => {
    const week = nextPlanningWeek(
      new Date('2026-10-18T08:00:00Z'),
      'Europe/Prague',
    );
    expect(week.key).toBe('2026-10-19');
    expect(planDate(week, 1, '09:00', 'Europe/Prague').toISOString()).toBe(
      '2026-10-19T07:00:00.000Z',
    );
  });

  it('returns a Monday-to-Sunday ISO range', () => {
    const week = isoWeekRange(
      new Date('2026-10-14T12:00:00Z'),
      'Europe/Prague',
    );
    expect(week.key).toBe('2026-10-12');
    expect(week.start.toISOString()).toBe('2026-10-11T22:00:00.000Z');
    expect(week.end.toISOString()).toBe('2026-10-18T21:59:59.000Z');
  });
});
