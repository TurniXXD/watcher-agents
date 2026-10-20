import type { CalendarEvent } from '@watcher/google-calendar';

export {
  GoogleCalendarProvider,
  type CalendarEvent,
} from '@watcher/google-calendar';

const zonedParts = (date: Date, timezone: string) => {
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
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
};

const localMidnightUtc = (
  year: number,
  month: number,
  day: number,
  timezone: string,
): Date => {
  const desired = Date.UTC(year, month - 1, day);
  let candidate = desired;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = zonedParts(new Date(candidate), timezone);
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    candidate += desired - represented;
  }
  return new Date(candidate);
};

export const calendarDayWindow = (
  now: Date,
  timezone: string,
  dayOffset = 0,
): { start: Date; end: Date } => {
  const today = zonedParts(now, timezone);
  const target = new Date(
    Date.UTC(today.year, today.month - 1, today.day + dayOffset),
  );
  const next = new Date(
    Date.UTC(
      target.getUTCFullYear(),
      target.getUTCMonth(),
      target.getUTCDate() + 1,
    ),
  );
  return {
    start: localMidnightUtc(
      target.getUTCFullYear(),
      target.getUTCMonth() + 1,
      target.getUTCDate(),
      timezone,
    ),
    end: localMidnightUtc(
      next.getUTCFullYear(),
      next.getUTCMonth() + 1,
      next.getUTCDate(),
      timezone,
    ),
  };
};

export const renderCalendarSummary = (
  events: readonly CalendarEvent[],
  day: 'today' | 'tomorrow' = 'today',
): string => {
  if (events.length === 0) return `Your calendar is clear ${day}.`;
  const first = events[0]!;
  const firstTime = first.allDay
    ? 'an all-day event'
    : `at ${first.start.split('T')[1]?.slice(0, 5) ?? first.start}`;
  return `You have ${events.length} calendar ${events.length === 1 ? 'event' : 'events'} ${day}. Your first is ${first.title} ${firstTime}.`;
};

const timedEvent = (event: CalendarEvent): boolean =>
  !event.allDay &&
  Number.isFinite(Date.parse(event.start)) &&
  Number.isFinite(Date.parse(event.end));

export const calendarActionInsights = (
  events: readonly CalendarEvent[],
): string[] => {
  const timed = events.filter(timedEvent);
  const insights: string[] = [];
  for (let index = 0; index < timed.length; index += 1) {
    const current = timed[index]!;
    const next = timed[index + 1];
    if (!next) break;
    const gapMinutes =
      (Date.parse(next.start) - Date.parse(current.end)) / 60_000;
    if (gapMinutes < 0) {
      insights.push(`${current.title} overlaps with ${next.title}.`);
    } else if (gapMinutes < 15) {
      insights.push(
        `Only ${Math.round(gapMinutes)} minutes separate ${current.title} and ${next.title}.`,
      );
    }
    if (
      current.location &&
      next.location &&
      current.location !== next.location &&
      gapMinutes < 45
    ) {
      insights.push(
        `Allow travel time from ${current.location} to ${next.location}.`,
      );
    }
  }
  const deadline = events.find((event) =>
    /deadline|due|uzávěr|termín/iu.test(event.title),
  );
  if (deadline) insights.unshift(`Do not miss ${deadline.title}.`);
  const firstTimed = timed[0];
  if (firstTimed) {
    insights.unshift(`Prepare for ${firstTimed.title} before it starts.`);
  }
  return [...new Set(insights)].slice(0, 5);
};
