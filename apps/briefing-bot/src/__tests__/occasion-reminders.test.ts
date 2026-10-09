import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../calendar.js';
import {
  calendarOccasionReminders,
  isMondayMorning,
  mondayOccasionWindow,
  renderSpokenOccasionReminders,
} from '../occasion-reminders.js';

const event = (
  id: string,
  title: string,
  start: string,
  calendarName?: string,
): CalendarEvent => ({
  id,
  title,
  start,
  end: start,
  allDay: true,
  ...(calendarName ? { calendarName } : {}),
});

describe('Monday Calendar occasion reminders', () => {
  it('uses the next two full weeks in the configured timezone', () => {
    const mondayMorning = new Date('2026-10-05T05:00:00.000Z');
    const window = mondayOccasionWindow(mondayMorning, 'Europe/Prague');

    expect(window.start.toISOString()).toBe('2026-10-11T22:00:00.000Z');
    expect(window.secondWeekStart.toISOString()).toBe(
      '2026-10-18T22:00:00.000Z',
    );
    expect(window.end.toISOString()).toBe('2026-10-25T23:00:00.000Z');
    expect(isMondayMorning(mondayMorning, 'Europe/Prague', 'morning')).toBe(
      true,
    );
    expect(isMondayMorning(mondayMorning, 'Europe/Prague', 'evening')).toBe(
      false,
    );
  });

  it('finds birthdays and personal name days without treating public holidays as people', () => {
    const window = mondayOccasionWindow(
      new Date('2026-10-05T05:00:00.000Z'),
      'Europe/Prague',
    );
    const reminders = calendarOccasionReminders(
      [
        event('birthday', 'Narozeniny Jany', '2026-10-15'),
        event('birthday-copy', 'Narozeniny Jany', '2026-10-15'),
        event('birthday-narozky', 'Narozky Tomáše', '2026-10-16'),
        event('name-day', 'Svátek má Petr', '2026-10-22'),
        {
          ...event('google-birthday', 'Alice', '2026-10-23', 'Primary'),
          eventType: 'birthday',
        },
        event('holiday', 'Státní svátek', '2026-10-20'),
        event('meeting', 'Porada', '2026-10-21'),
      ],
      'Europe/Prague',
      window.secondWeekStart,
    );

    expect(reminders).toMatchObject([
      {
        kind: 'BIRTHDAY',
        leadWeeks: 1,
        title: 'Narozeniny Jany',
        dateLabel: 'čtvrtek 15. října',
      },
      {
        kind: 'BIRTHDAY',
        leadWeeks: 1,
        title: 'Narozky Tomáše',
        dateLabel: 'pátek 16. října',
      },
      {
        kind: 'NAME_DAY',
        leadWeeks: 2,
        title: 'Svátek má Petr',
        dateLabel: 'čtvrtek 22. října',
      },
      {
        kind: 'BIRTHDAY',
        leadWeeks: 2,
        title: 'Alice',
        dateLabel: 'pátek 23. října',
      },
    ]);
  });

  it('renders deterministic Czech audio text for both reminder weeks', () => {
    const spoken = renderSpokenOccasionReminders({
      status: 'AVAILABLE',
      reminders: [
        {
          kind: 'BIRTHDAY',
          leadWeeks: 1,
          title: 'Narozeniny Jany',
          start: '2026-10-15',
          dateLabel: 'čtvrtek 15. října',
        },
        {
          kind: 'NAME_DAY',
          leadWeeks: 2,
          title: 'Svátek má Petr',
          start: '2026-10-22',
          dateLabel: 'čtvrtek 22. října',
        },
      ],
    });

    expect(spoken).toContain('V týdnu za týden');
    expect(spoken).toContain('Narozeniny Jany, narozeniny');
    expect(spoken).toContain('V týdnu za dva týdny');
    expect(spoken).toContain('Svátek má Petr, svátek');
  });
});
