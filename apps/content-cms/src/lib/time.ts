/**
 * Time-zone helpers that rely only on the platform `Intl` database so DST
 * transitions follow the IANA rules shipped with Node.js.
 */
export const DEFAULT_TIME_ZONE = 'Europe/Prague';

export const isValidTimeZone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

const partsFormatter = new Map<string, Intl.DateTimeFormat>();
const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  let formatter = partsFormatter.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatter.set(timeZone, formatter);
  }
  return formatter;
};

export type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export const localParts = (instant: Date, timeZone: string): LocalParts => {
  const values: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  return {
    year: values.year ?? 0,
    month: values.month ?? 0,
    day: values.day ?? 0,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
};

/** Offset of `timeZone` from UTC at `instant`, in milliseconds. */
export const timeZoneOffsetMs = (instant: Date, timeZone: string): number => {
  const parts = localParts(instant, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
};

/**
 * Converts a wall-clock time in `timeZone` to a UTC instant. Non-existent
 * spring-forward times resolve forward; ambiguous autumn times resolve to the
 * earlier (summer-time) instant.
 */
export const zonedTimeToUtc = (
  local: Omit<LocalParts, 'second'> & { second?: number },
  timeZone: string,
): Date => {
  const naive = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second ?? 0,
  );
  const candidates = new Set<number>();
  for (const probe of [naive - 86_400_000, naive, naive + 86_400_000]) {
    candidates.add(naive - timeZoneOffsetMs(new Date(probe), timeZone));
  }
  const exact = [...candidates]
    .sort((a, b) => a - b)
    .find((candidate) => {
      const parts = localParts(new Date(candidate), timeZone);
      return (
        parts.year === local.year &&
        parts.month === local.month &&
        parts.day === local.day &&
        parts.hour === local.hour &&
        parts.minute === local.minute
      );
    });
  if (exact !== undefined) return new Date(exact);
  // Spring-forward gap: the later candidate moves the wall time forward (02:30 → 03:30).
  return new Date(Math.max(...candidates));
};

/** `YYYY-MM-DD` of an instant in `timeZone`. */
export const localDateString = (instant: Date, timeZone: string): string => {
  const { year, month, day } = localParts(instant, timeZone);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** Start of a calendar day in `timeZone`. */
export const startOfLocalDay = (date: string, timeZone: string): Date => {
  const match = DATE_ONLY.exec(date);
  if (!match) throw new RangeError(`Invalid date: ${date}`);
  const [, year, month, day] = match;
  const check = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day)),
  );
  if (
    check.getUTCFullYear() !== Number(year) ||
    check.getUTCMonth() !== Number(month) - 1 ||
    check.getUTCDate() !== Number(day)
  ) {
    throw new RangeError(`Invalid date: ${date}`);
  }
  return zonedTimeToUtc(
    {
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: 0,
      minute: 0,
    },
    timeZone,
  );
};

const addDays = (date: string, days: number): string => {
  const [year, month, day] = date.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
};

/**
 * Resolves a public `from`/`to` filter. Date-only values are calendar days in
 * `timeZone`; `to` is inclusive of the whole day, so it returns the exclusive
 * start of the following day. Full timestamps must carry an offset.
 */
export const resolveDateFilter = (
  value: string,
  bound: 'from' | 'to',
  timeZone = DEFAULT_TIME_ZONE,
): { instant: Date; exclusive: boolean } => {
  if (DATE_ONLY.test(value)) {
    return bound === 'from'
      ? { instant: startOfLocalDay(value, timeZone), exclusive: false }
      : {
          instant: startOfLocalDay(addDays(value, 1), timeZone),
          exclusive: true,
        };
  }
  if (!/(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) {
    throw new RangeError('Timestamps must include a UTC offset');
  }
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime()))
    throw new RangeError('Invalid timestamp');
  return { instant, exclusive: false };
};
