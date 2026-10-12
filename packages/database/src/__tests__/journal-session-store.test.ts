import { describe, expect, it } from 'vitest';
import { journalReminderInstant } from '../journal-session-store.js';

describe('journalReminderInstant', () => {
  it('keeps 21:00 Prague local time across the spring DST change', () => {
    expect(
      journalReminderInstant(
        '2026-03-28',
        '21:00',
        'Europe/Prague',
      ).toISOString(),
    ).toBe('2026-03-28T20:00:00.000Z');
    expect(
      journalReminderInstant(
        '2026-03-29',
        '21:00',
        'Europe/Prague',
      ).toISOString(),
    ).toBe('2026-03-29T19:00:00.000Z');
  });

  it('keeps 21:00 Prague local time across the autumn DST change', () => {
    expect(
      journalReminderInstant(
        '2026-10-24',
        '21:00',
        'Europe/Prague',
      ).toISOString(),
    ).toBe('2026-10-24T19:00:00.000Z');
    expect(
      journalReminderInstant(
        '2026-10-25',
        '21:00',
        'Europe/Prague',
      ).toISOString(),
    ).toBe('2026-10-25T20:00:00.000Z');
  });
});
