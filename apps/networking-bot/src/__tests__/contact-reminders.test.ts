import type { NetworkContact } from '@watcher/contact-network';
import { describe, expect, it } from 'vitest';
import {
  buildContactReminderJobs,
  canonicalContactMetDate,
  parseContactMetDate,
} from '../contact-reminders.js';

const contact = (overrides: Partial<NetworkContact> = {}): NetworkContact => ({
  id: '12',
  name: 'Ada Lovelace',
  metDate: '2026-01-31',
  active: true,
  ...overrides,
});

describe('contact reminders', () => {
  it('parses ISO and Czech sheet dates and rejects impossible dates', () => {
    expect(parseContactMetDate('2026-10-29')).toEqual({
      year: 2026,
      month: 10,
      day: 29,
    });
    expect(canonicalContactMetDate('29. 10. 2026')).toBe('2026-10-29');
    expect(parseContactMetDate('31. 2. 2026')).toBeUndefined();
    expect(parseContactMetDate('October 29')).toBeUndefined();
  });

  it('creates stable 2-day, 7-day and calendar-month jobs at 09:00 local time', () => {
    const jobs = buildContactReminderJobs({
      contact: contact(),
      now: new Date('2026-01-31T08:00:00.000Z'),
      timezone: 'Europe/Prague',
    });

    expect(
      jobs.map((job) => [job.payload.milestone, job.scheduledFor]),
    ).toEqual([
      ['2d', new Date('2026-02-02T08:00:00.000Z')],
      ['7d', new Date('2026-02-07T08:00:00.000Z')],
      ['1m', new Date('2026-02-28T08:00:00.000Z')],
    ]);
    expect(new Set(jobs.map((job) => job.kind))).toHaveLength(3);
  });

  it('skips inactive, future-dated, invalid and historical contacts', () => {
    const now = new Date('2026-10-31T08:00:00.000Z');
    const options = { now, timezone: 'Europe/Prague' };

    expect(
      buildContactReminderJobs({
        contact: contact({ active: false, metDate: '2026-10-29' }),
        ...options,
      }),
    ).toEqual([]);
    expect(
      buildContactReminderJobs({
        contact: contact({ metDate: '2026-11-01' }),
        ...options,
      }),
    ).toEqual([]);
    expect(
      buildContactReminderJobs({
        contact: contact({ metDate: 'not-a-date' }),
        ...options,
      }),
    ).toEqual([]);
    expect(
      buildContactReminderJobs({
        contact: contact({ metDate: '2025-01-01' }),
        ...options,
      }),
    ).toEqual([]);
  });
});
