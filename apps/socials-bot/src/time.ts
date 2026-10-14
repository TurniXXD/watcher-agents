import { computeNextRun } from '@watcher/core';

export type IsoWeekRange = {
  start: Date;
  end: Date;
  key: string;
};

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const partsInTimezone = (date: Date, timezone: string): LocalParts => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
};

export const dateInTimezone = (
  parts: Omit<LocalParts, 'second'> & { second?: number },
  timezone: string,
): Date => {
  const desired = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second ?? 0,
  );
  let candidate = new Date(desired);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = partsInTimezone(candidate, timezone);
    const represented = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    candidate = new Date(candidate.getTime() + desired - represented);
  }
  return candidate;
};

const localDate = (date: Date, timezone: string): Date => {
  const parts = partsInTimezone(date, timezone);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
};

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

export const isoWeekRange = (
  now: Date,
  timezone: string,
  offsetWeeks = 0,
): IsoWeekRange => {
  const local = localDate(now, timezone);
  const weekday = local.getUTCDay() || 7;
  const monday = new Date(local);
  monday.setUTCDate(local.getUTCDate() - weekday + 1 + offsetWeeks * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const start = dateInTimezone(
    {
      year: monday.getUTCFullYear(),
      month: monday.getUTCMonth() + 1,
      day: monday.getUTCDate(),
      hour: 0,
      minute: 0,
    },
    timezone,
  );
  const end = dateInTimezone(
    {
      year: sunday.getUTCFullYear(),
      month: sunday.getUTCMonth() + 1,
      day: sunday.getUTCDate(),
      hour: 23,
      minute: 59,
      second: 59,
    },
    timezone,
  );
  return { start, end, key: isoDate(monday) };
};

export const nextPlanningWeek = (now: Date, timezone: string): IsoWeekRange => {
  const local = partsInTimezone(now, timezone);
  const localDay = new Date(
    Date.UTC(local.year, local.month - 1, local.day),
  ).getUTCDay();
  return isoWeekRange(now, timezone, localDay === 0 ? 1 : 0);
};

export const planDate = (
  week: IsoWeekRange,
  weekday: number,
  time: string,
  timezone: string,
): Date => {
  const monday = new Date(`${week.key}T00:00:00.000Z`);
  monday.setUTCDate(monday.getUTCDate() + weekday - 1);
  const [hour, minute] = time.split(':').map(Number);
  return dateInTimezone(
    {
      year: monday.getUTCFullYear(),
      month: monday.getUTCMonth() + 1,
      day: monday.getUTCDate(),
      hour: hour ?? 0,
      minute: minute ?? 0,
    },
    timezone,
  );
};

export const nextSundayReminder = (
  after: Date,
  timezone: string,
  time = '09:00',
): Date => {
  const [hour, minute] = time.split(':').map(Number);
  return computeNextRun(`${minute ?? 0} ${hour ?? 9} * * 0`, timezone, after);
};

export const formatPragueDateTime = (
  date: Date,
  timezone = 'Europe/Prague',
): string =>
  new Intl.DateTimeFormat('cs-CZ', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
