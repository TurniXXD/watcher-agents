import type { CalendarEvent } from './calendar.js';
import { calendarDayWindow } from './calendar.js';
import type { BriefingDayPeriod } from './utils/day-period.js';

export type CalendarOccasionKind = 'BIRTHDAY' | 'NAME_DAY';

export type CalendarOccasionReminder = {
  kind: CalendarOccasionKind;
  leadWeeks: 1 | 2;
  title: string;
  start: string;
  dateLabel: string;
};

export type CalendarOccasionReminderContext = {
  status: 'AVAILABLE' | 'UNAVAILABLE' | 'DISABLED';
  reminders: readonly CalendarOccasionReminder[];
};

const birthdayPattern = /\b(?:birthday|birthdays|narozky)\b|narozenin/iu;
const nameDayPattern = /\bname[\s-]?day\b|svátek|svatek|jmeniny/iu;
const publicHolidayPattern =
  /státní\s+svátek|statni\s+svatek|public\s+holiday|bank\s+holiday/iu;

const dateInTimezone = (date: Date, timezone: string): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

const eventLocalDate = (event: CalendarEvent, timezone: string): string => {
  if (event.allDay && /^\d{4}-\d{2}-\d{2}$/u.test(event.start)) {
    return event.start;
  }
  const parsed = new Date(event.start);
  return Number.isFinite(parsed.getTime())
    ? dateInTimezone(parsed, timezone)
    : event.start.slice(0, 10);
};

const eventDateLabel = (event: CalendarEvent, timezone: string): string => {
  const parsed = event.allDay
    ? new Date(`${eventLocalDate(event, timezone)}T12:00:00.000Z`)
    : new Date(event.start);
  if (!Number.isFinite(parsed.getTime())) return event.start;
  return new Intl.DateTimeFormat('cs-CZ', {
    timeZone: event.allDay ? 'UTC' : timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(parsed);
};

const occasionKind = (
  event: CalendarEvent,
): CalendarOccasionKind | undefined => {
  const title = event.title.trim();
  const searchable = `${title} ${event.calendarName ?? ''}`;
  if (publicHolidayPattern.test(searchable)) return undefined;
  if (event.eventType === 'birthday' || birthdayPattern.test(searchable)) {
    return 'BIRTHDAY';
  }
  if (nameDayPattern.test(searchable)) return 'NAME_DAY';
  return undefined;
};

export const isMondayMorning = (
  date: Date,
  timezone: string,
  dayPeriod: BriefingDayPeriod,
): boolean =>
  dayPeriod === 'morning' &&
  new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  }).format(date) === 'Mon';

export const mondayOccasionWindow = (
  date: Date,
  timezone: string,
): { start: Date; secondWeekStart: Date; end: Date } => ({
  start: calendarDayWindow(date, timezone, 7).start,
  secondWeekStart: calendarDayWindow(date, timezone, 14).start,
  end: calendarDayWindow(date, timezone, 21).start,
});

export const calendarOccasionReminders = (
  events: readonly CalendarEvent[],
  timezone: string,
  secondWeekStart: Date,
): CalendarOccasionReminder[] => {
  const secondWeekDate = dateInTimezone(secondWeekStart, timezone);
  const seen = new Set<string>();
  const reminders: CalendarOccasionReminder[] = [];
  for (const event of events) {
    const kind = occasionKind(event);
    if (!kind) continue;
    const localDate = eventLocalDate(event, timezone);
    const key = `${kind}:${localDate}:${event.title.trim().toLocaleLowerCase('cs-CZ')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    reminders.push({
      kind,
      leadWeeks: localDate < secondWeekDate ? 1 : 2,
      title: event.title.trim(),
      start: event.start,
      dateLabel: eventDateLabel(event, timezone),
    });
  }
  return reminders.sort(
    (left, right) =>
      left.start.localeCompare(right.start) ||
      left.title.localeCompare(right.title),
  );
};

export const renderSpokenOccasionReminders = (
  context: CalendarOccasionReminderContext | undefined,
): string | undefined => {
  if (!context || context.status === 'DISABLED') return undefined;
  if (context.status === 'UNAVAILABLE') {
    return 'Pondělní připomínky narozenin a svátků se z kalendáře nepodařilo načíst.';
  }
  if (context.reminders.length === 0) return undefined;
  const section = (leadWeeks: 1 | 2) => {
    const reminders = context.reminders.filter(
      (reminder) => reminder.leadWeeks === leadWeeks,
    );
    if (reminders.length === 0) return undefined;
    return `V týdnu za ${leadWeeks === 1 ? 'týden' : 'dva týdny'}: ${reminders
      .map(
        ({ dateLabel, title, kind }) =>
          `${dateLabel}, ${title}, ${kind === 'BIRTHDAY' ? 'narozeniny' : 'svátek'}`,
      )
      .join('; ')}.`;
  };
  return [
    'Pondělní kalendářní připomínka narozenin a svátků.',
    section(1),
    section(2),
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ');
};
