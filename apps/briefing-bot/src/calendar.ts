import type { CalendarIntegrationStore } from '@watcher/database';
import { z } from 'zod';
import type { GoogleCalendarOAuth } from './calendar-oauth.js';

const calendarResponseSchema = z.object({
  summary: z.string().optional(),
  nextPageToken: z.string().optional(),
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        status: z.string().optional(),
        summary: z.string().optional(),
        location: z.string().optional(),
        start: z.object({
          date: z.string().optional(),
          dateTime: z.string().optional(),
        }),
        end: z.object({
          date: z.string().optional(),
          dateTime: z.string().optional(),
        }),
      }),
    )
    .optional(),
});

export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  calendarName?: string;
};

type Fetch = typeof fetch;
type CalendarConnectionStore = Pick<CalendarIntegrationStore, 'get'>;

const responseJson = async (response: Response): Promise<unknown> => {
  if (!response.ok) {
    throw new Error(`Google Calendar request failed: HTTP ${response.status}`);
  }
  return response.json() as Promise<unknown>;
};

export class GoogleCalendarProvider {
  public constructor(
    private readonly oauth: GoogleCalendarOAuth,
    private readonly integrations: CalendarConnectionStore,
    private readonly fetcher: Fetch = fetch,
  ) {}

  public async listEvents(
    telegramChatId: bigint,
    input: { start: Date; end: Date; timezone: string },
    signal?: AbortSignal,
  ): Promise<CalendarEvent[]> {
    if (input.end <= input.start) throw new Error('Invalid Calendar window');
    const integration = await this.integrations.get(telegramChatId);
    if (!integration?.connected) {
      throw new Error('Google Calendar is not connected');
    }
    const accessToken = await this.oauth.accessToken(telegramChatId);
    const events: CalendarEvent[] = [];
    for (const calendarId of integration.calendarIds) {
      let pageToken: string | undefined;
      let page = 0;
      do {
        const url = new URL(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
        );
        url.searchParams.set('timeMin', input.start.toISOString());
        url.searchParams.set('timeMax', input.end.toISOString());
        url.searchParams.set('timeZone', input.timezone);
        url.searchParams.set('singleEvents', 'true');
        url.searchParams.set('orderBy', 'startTime');
        url.searchParams.set('showDeleted', 'false');
        url.searchParams.set('maxResults', '100');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const response = calendarResponseSchema.parse(
          await responseJson(
            await this.fetcher(url, {
              headers: { authorization: `Bearer ${accessToken}` },
              ...(signal ? { signal } : {}),
            }),
          ),
        );
        for (const event of response.items ?? []) {
          if (event.status === 'cancelled') continue;
          const start = event.start.dateTime ?? event.start.date;
          const end = event.end.dateTime ?? event.end.date;
          if (!start || !end) continue;
          events.push({
            id: event.id,
            title: event.summary?.trim() || 'Busy',
            start,
            end,
            allDay: Boolean(event.start.date && !event.start.dateTime),
            ...(event.location ? { location: event.location } : {}),
            ...(response.summary ? { calendarName: response.summary } : {}),
          });
        }
        pageToken = response.nextPageToken;
        page += 1;
        if (page >= 10 && pageToken) {
          throw new Error('Google Calendar pagination limit exceeded');
        }
      } while (pageToken);
    }
    return events.sort((left, right) => left.start.localeCompare(right.start));
  }
}

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
): { start: Date; end: Date } => {
  const today = zonedParts(now, timezone);
  const next = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
  return {
    start: localMidnightUtc(today.year, today.month, today.day, timezone),
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
): string => {
  if (events.length === 0) return 'Your calendar is clear today.';
  const first = events[0]!;
  const firstTime = first.allDay
    ? 'an all-day event'
    : `at ${first.start.split('T')[1]?.slice(0, 5) ?? first.start}`;
  return `You have ${events.length} calendar ${events.length === 1 ? 'event' : 'events'} today. Your first is ${first.title} ${firstTime}.`;
};
