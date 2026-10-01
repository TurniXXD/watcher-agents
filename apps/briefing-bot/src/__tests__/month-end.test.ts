import { describe, expect, it } from 'vitest';
import { isLastCalendarDayOfMonth } from '../month-end.js';

describe('month-end reminder date', () => {
  it.each([
    ['2026-02-28', true],
    ['2028-02-29', true],
    ['2026-04-30', true],
    ['2026-12-31', true],
    ['2026-02-27', false],
    ['2028-02-28', false],
    ['2026-04-31', false],
    ['2026-13-31', false],
  ])('recognizes %s as month-end: %s', (date, expected) => {
    expect(isLastCalendarDayOfMonth(date)).toBe(expected);
  });
});
