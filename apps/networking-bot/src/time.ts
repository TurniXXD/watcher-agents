type LocalDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

export const partsInTimezone = (
  date: Date,
  timezone: string,
): LocalDateTime => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
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
  };
};

const localDate = (
  parts: Pick<LocalDateTime, 'year' | 'month' | 'day'>,
  days: number,
): Pick<LocalDateTime, 'year' | 'month' | 'day'> => {
  const date = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days),
  );
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
};

export const dateInTimezone = (
  parts: LocalDateTime,
  timezone: string,
): Date => {
  const desired = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
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
    );
    candidate = new Date(candidate.getTime() + desired - represented);
  }
  return candidate;
};

export const localDayWindow = (
  now: Date,
  timezone: string,
): { from: Date; to: Date } => {
  const today = partsInTimezone(now, timezone);
  const tomorrow = localDate(today, 1);
  return {
    from: now,
    to: new Date(
      dateInTimezone({ ...tomorrow, hour: 0, minute: 0 }, timezone).getTime() -
        1,
    ),
  };
};

export const localWeekWindow = (
  now: Date,
  timezone: string,
): { from: Date; to: Date } => {
  const today = partsInTimezone(now, timezone);
  const localMidnightUtc = new Date(
    Date.UTC(today.year, today.month - 1, today.day),
  );
  const daysUntilNextMonday = 8 - (localMidnightUtc.getUTCDay() || 7);
  const nextMonday = localDate(today, daysUntilNextMonday);
  return {
    from: now,
    to: new Date(
      dateInTimezone(
        { ...nextMonday, hour: 0, minute: 0 },
        timezone,
      ).getTime() - 1,
    ),
  };
};

export const formatLocalDateTime = (
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
