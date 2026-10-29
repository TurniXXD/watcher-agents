import { splitTelegramMessage } from '@watcher/telegram';
import {
  trading212ScheduledKind,
  type TelegramOutboxStore,
  type Trading212ScheduleStore,
} from '@watcher/database';
import type { Trading212Client } from './trading212.js';
import { renderTrading212Positions } from './trading212.js';

const newYorkClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

export type Trading212Slot = {
  date: string;
  name: 'close';
  closeTime: '13:00' | '16:00';
};

const dateKey = ({ year, month, day }: CalendarDate): string =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const utcDate = ({ year, month, day }: CalendarDate): Date =>
  new Date(Date.UTC(year, month - 1, day));

const fromUtcDate = (date: Date): CalendarDate => ({
  year: date.getUTCFullYear(),
  month: date.getUTCMonth() + 1,
  day: date.getUTCDate(),
});

const addDays = (date: CalendarDate, days: number): CalendarDate => {
  const value = utcDate(date);
  value.setUTCDate(value.getUTCDate() + days);
  return fromUtcDate(value);
};

const weekday = (date: CalendarDate): number => utcDate(date).getUTCDay();

const nthWeekday = (
  year: number,
  month: number,
  targetWeekday: number,
  occurrence: number,
): CalendarDate => {
  const first = { year, month, day: 1 };
  return {
    year,
    month,
    day: 1 + ((targetWeekday - weekday(first) + 7) % 7) + 7 * (occurrence - 1),
  };
};

const lastWeekday = (
  year: number,
  month: number,
  targetWeekday: number,
): CalendarDate => {
  const last = fromUtcDate(new Date(Date.UTC(year, month, 0)));
  return {
    ...last,
    day: last.day - ((weekday(last) - targetWeekday + 7) % 7),
  };
};

// Gregorian Easter, used because NYSE closes on Good Friday.
const easterSunday = (year: number): CalendarDate => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { year, month, day };
};

const observedFixedHoliday = (
  year: number,
  month: number,
  day: number,
): CalendarDate => {
  const holiday = { year, month, day };
  const holidayWeekday = weekday(holiday);
  if (holidayWeekday === 0) return addDays(holiday, 1);
  if (holidayWeekday === 6) return addDays(holiday, -1);
  return holiday;
};

const nyseHolidays = (year: number): Set<string> => {
  const holidays = [
    { year, month: 1, day: 1 },
    nthWeekday(year, 1, 1, 3),
    nthWeekday(year, 2, 1, 3),
    addDays(easterSunday(year), -2),
    lastWeekday(year, 5, 1),
    observedFixedHoliday(year, 7, 4),
    nthWeekday(year, 9, 1, 1),
    nthWeekday(year, 11, 4, 4),
    observedFixedHoliday(year, 12, 25),
  ];

  // NYSE has observed Juneteenth since 2022.
  if (year >= 2022) {
    holidays.push(observedFixedHoliday(year, 6, 19));
  }

  // When New Year's Day is Saturday, NYSE remains open on the preceding
  // Friday so the holiday does not cross an accounting year boundary.
  if (weekday({ year, month: 1, day: 1 }) === 6) {
    holidays.shift();
  } else {
    holidays[0] = observedFixedHoliday(year, 1, 1);
  }

  return new Set(holidays.map(dateKey));
};

const isEarlyClose = (date: CalendarDate): boolean => {
  const key = dateKey(date);
  const thanksgiving = nthWeekday(date.year, 11, 4, 4);
  if (key === dateKey(addDays(thanksgiving, 1))) return true;

  const christmasEve = { year: date.year, month: 12, day: 24 };
  const christmasEveWeekday = weekday(christmasEve);
  if (
    key === dateKey(christmasEve) &&
    christmasEveWeekday >= 1 &&
    christmasEveWeekday <= 5
  ) {
    return true;
  }

  const julyThird = { year: date.year, month: 7, day: 3 };
  const julyThirdWeekday = weekday(julyThird);
  return (
    key === dateKey(julyThird) && julyThirdWeekday >= 1 && julyThirdWeekday <= 5
  );
};

export const trading212SlotAt = (now: Date): Trading212Slot | undefined => {
  const parts = Object.fromEntries(
    newYorkClock.formatToParts(now).map((part) => [part.type, part.value]),
  );
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return undefined;
  const date = {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
  const key = dateKey(date);
  if (nyseHolidays(date.year).has(key)) return undefined;

  const earlyClose = isEarlyClose(date);
  const closeHour = earlyClose ? 13 : 16;
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  // Keep the slot eligible for the rest of the local day so a short restart at
  // the close does not lose the report. The outbox key and in-process slot key
  // still ensure that the session is queued only once.
  if (hour < closeHour || (hour === closeHour && minute < 5)) return undefined;
  return {
    date: key,
    name: 'close',
    closeTime: earlyClose ? '13:00' : '16:00',
  };
};

export const enqueueTrading212Positions = async (
  now: Date,
  chatId: bigint,
  schedule: Pick<Trading212ScheduleStore, 'enabled'>,
  client: Pick<Trading212Client, 'getPortfolio'>,
  outbox: Pick<TelegramOutboxStore, 'enqueue'>,
): Promise<boolean> => {
  const slot = trading212SlotAt(now);
  if (!slot || !(await schedule.enabled(chatId))) return false;
  const portfolio = await client.getPortfolio();
  const parts = splitTelegramMessage(
    `📊 Trading 212 · po zavření trhu\n${slot.date} · close ${slot.closeTime} New York\n\n${renderTrading212Positions(portfolio)}`,
  );
  for (const [index, body] of parts.entries()) {
    await outbox.enqueue({
      kind: trading212ScheduledKind,
      deduplicationKey: `${chatId}:${slot.date}:${slot.name}:${index}`,
      chatId,
      body,
    });
  }
  return true;
};
