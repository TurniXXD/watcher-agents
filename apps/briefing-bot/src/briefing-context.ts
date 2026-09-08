import type { WatcherLogger } from '@watcher/core';
import type { BriefingConfiguration } from '@watcher/database';
import type { CalendarEvent } from './calendar.js';
import { calendarDayWindow } from './calendar.js';
import type { ContextAvailability } from './script-generator.js';
import type { WeatherContext, WeatherProvider } from './weather.js';

export type CalendarProvider = {
  listEvents: (
    telegramChatId: bigint,
    input: { start: Date; end: Date; timezone: string },
    signal?: AbortSignal,
  ) => Promise<CalendarEvent[]>;
};

export type AvailableContext<T> = {
  status: ContextAvailability;
  value: T;
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
    logger?.warn({ err: error }, 'CALENDAR = DEGRADED');
    return { status: 'UNAVAILABLE', value: [] };
  }
};
