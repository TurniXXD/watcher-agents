import { describe, expect, it } from 'vitest';
import { briefingDayPeriodFor } from '../utils/day-period.js';

describe('briefingDayPeriodFor', () => {
  it.each([
    ['00:00', 'night'],
    ['04:59', 'night'],
    ['05:00', 'morning'],
    ['11:59', 'morning'],
    ['12:00', 'afternoon'],
    ['16:59', 'afternoon'],
    ['17:00', 'evening'],
    ['21:59', 'evening'],
    ['22:00', 'night'],
    ['23:59', 'night'],
  ] as const)('maps %s to %s', (localTime, expected) => {
    expect(briefingDayPeriodFor(localTime)).toBe(expected);
  });

  it('rejects invalid local times', () => {
    expect(() => briefingDayPeriodFor('24:00')).toThrow(
      'Invalid local briefing time',
    );
  });
});
