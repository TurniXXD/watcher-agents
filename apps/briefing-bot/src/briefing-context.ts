import type { WatcherLogger } from '@watcher/core';
import type { BriefingConfiguration } from '@watcher/database';
import type { CalendarEvent } from './calendar.js';
import { calendarDayWindow } from './calendar.js';
import type { ContextAvailability } from './script-generator.js';
import {
  calendarOccasionReminders,
  isMondayMorning,
  mondayOccasionWindow,
  type CalendarOccasionReminderContext,
} from './occasion-reminders.js';
import type { BriefingDayPeriod } from './utils/day-period.js';
import type {
  WeatherContext,
  WeatherForecastTarget,
  WeatherProvider,
} from './weather.js';
import type { JournalEntry } from './notion-journal.js';

export type CalendarProvider = {
  listEvents: (
    telegramChatId: bigint,
    input: {
      start: Date;
      end: Date;
      timezone: string;
      includeOccasionCalendars?: boolean;
    },
    signal?: AbortSignal,
  ) => Promise<CalendarEvent[]>;
};

export type AvailableContext<T> = {
  status: ContextAvailability;
  value: T;
};

export type JournalProvider = {
  loadYesterday: (
    now?: Date,
    signal?: AbortSignal,
  ) => Promise<JournalEntry | undefined>;
};

export type JournalContext = AvailableContext<JournalEntry | undefined>;

export const loadBriefingJournal = async (
  journal: JournalProvider | undefined,
  dayPeriod: BriefingDayPeriod,
  presentationTime: Date,
  logger?: WatcherLogger,
): Promise<JournalContext> => {
  if (!journal || dayPeriod !== 'morning') {
    return { status: 'DISABLED', value: undefined };
  }
  try {
    return {
      status: 'AVAILABLE',
      value: await journal.loadYesterday(
        presentationTime,
        AbortSignal.timeout(15_000),
      ),
    };
  } catch (error) {
    logger?.warn({ err: error }, 'NOTION JOURNAL = DEGRADED');
    return { status: 'UNAVAILABLE', value: undefined };
  }
};

export const dateParts = (date: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  };
};

export const dateLabel = (date: Date, timezone: string): string =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(date);

export const locationLabel = (location: {
  city?: string | undefined;
  country?: string | undefined;
}): string | undefined =>
  [location.city, location.country].filter(Boolean).join(', ') || undefined;

export const measured = async <T>(
  task: () => Promise<T>,
): Promise<{ value: T; durationMs: number }> => {
  const startedAt = Date.now();
  return { value: await task(), durationMs: Date.now() - startedAt };
};

export const loadBriefingWeather = async (
  configuration: BriefingConfiguration,
  weather: WeatherProvider,
  logger?: WatcherLogger,
  target?: WeatherForecastTarget,
): Promise<AvailableContext<WeatherContext | undefined>> => {
  const location = configuration.location;
  if (
    !configuration.settings.weatherEnabled ||
    !location ||
    location.mode === 'DISABLED' ||
    location.latitude === undefined ||
    location.longitude === undefined
  ) {
    return { status: 'DISABLED', value: undefined };
  }
  try {
    return {
      status: 'AVAILABLE',
      value: await weather.forecast(
        location.latitude,
        location.longitude,
        configuration.settings.timezone,
        AbortSignal.timeout(15_000),
        target,
      ),
    };
  } catch (error) {
    logger?.warn({ err: error }, 'WEATHER = DEGRADED');
    return { status: 'UNAVAILABLE', value: undefined };
  }
};

export const loadBriefingCalendar = async (
  telegramChatId: bigint,
  configuration: BriefingConfiguration,
  calendar: CalendarProvider | undefined,
  logger?: WatcherLogger,
  now = new Date(),
  dayOffset = 0,
): Promise<AvailableContext<CalendarEvent[]>> => {
  if (!configuration.settings.calendarEnabled) {
    return { status: 'DISABLED', value: [] };
  }
  if (!calendar) return { status: 'UNAVAILABLE', value: [] };
  try {
    const window = calendarDayWindow(
      now,
      configuration.settings.timezone,
      dayOffset,
    );
    return {
      status: 'AVAILABLE',
      value: await calendar.listEvents(
        telegramChatId,
        { ...window, timezone: configuration.settings.timezone },
        AbortSignal.timeout(15_000),
      ),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'Google Calendar is not connected'
    ) {
      logger?.info('Calendar is not connected; optional context is disabled');
      return { status: 'DISABLED', value: [] };
    }
    logger?.warn({ err: error }, 'CALENDAR = DEGRADED');
    return { status: 'UNAVAILABLE', value: [] };
  }
};

export const loadMondayOccasionReminders = async (
  telegramChatId: bigint,
  configuration: BriefingConfiguration,
  calendar: CalendarProvider | undefined,
  presentationTime: Date,
  dayPeriod: BriefingDayPeriod,
  enabled: boolean,
  logger?: WatcherLogger,
): Promise<CalendarOccasionReminderContext> => {
  if (
    !enabled ||
    !isMondayMorning(
      presentationTime,
      configuration.settings.timezone,
      dayPeriod,
    ) ||
    !configuration.settings.calendarEnabled
  ) {
    return { status: 'DISABLED', reminders: [] };
  }
  if (!calendar) return { status: 'UNAVAILABLE', reminders: [] };
  try {
    const window = mondayOccasionWindow(
      presentationTime,
      configuration.settings.timezone,
    );
    const events = await calendar.listEvents(
      telegramChatId,
      {
        start: window.start,
        end: window.end,
        timezone: configuration.settings.timezone,
        includeOccasionCalendars: true,
      },
      AbortSignal.timeout(15_000),
    );
    return {
      status: 'AVAILABLE',
      reminders: calendarOccasionReminders(
        events,
        configuration.settings.timezone,
        window.secondWeekStart,
      ),
    };
  } catch (error) {
    logger?.warn({ err: error }, 'CALENDAR OCCASION REMINDERS = DEGRADED');
    return { status: 'UNAVAILABLE', reminders: [] };
  }
};
