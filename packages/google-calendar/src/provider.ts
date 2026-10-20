import { createHash } from 'node:crypto';
import type { CalendarIntegrationStore } from '@watcher/database';
import { z } from 'zod';
import type { GoogleCalendarOAuth } from './oauth.js';

const calendarResponseSchema = z.object({
  summary: z.string().optional(),
  nextPageToken: z.string().optional(),
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        status: z.string().optional(),
        eventType: z.string().optional(),
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

const calendarListResponseSchema = z.object({
  nextPageToken: z.string().optional(),
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        summary: z.string().optional(),
        deleted: z.boolean().optional(),
      }),
    )
    .optional(),
});

const createdEventSchema = z.object({
  id: z.string().min(1),
  htmlLink: z.url().optional(),
  summary: z.string().optional(),
});

export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  eventType?: string;
  location?: string;
  calendarName?: string;
};

export type CalendarEventWrite = {
  externalId: string;
  title: string;
  startAt: Date;
  endAt?: Date;
  timezone: string;
  location?: string;
  description?: string;
  colorId?: string;
};

export type CreatedCalendarEvent = {
  id: string;
  htmlLink?: string;
  duplicate: boolean;
};

export const GOOGLE_CALENDAR_MANGO_COLOR_ID = '6';

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

  public async createEvent(
    telegramChatId: bigint,
    input: CalendarEventWrite,
    signal?: AbortSignal,
  ): Promise<CreatedCalendarEvent> {
    const integration = await this.integrations.get(telegramChatId);
    if (!integration?.connected) {
      throw new Error('Google Calendar is not connected');
    }
    const accessToken = await this.oauth.accessToken(telegramChatId);
    const calendarId = integration.calendarIds[0] ?? 'primary';
    const eventId = `e${createHash('sha256')
      .update(`${telegramChatId.toString()}:${input.externalId}`)
      .digest('hex')}`;
    const eventUrl = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    );
    eventUrl.searchParams.set('sendUpdates', 'none');
    const endAt =
      input.endAt ?? new Date(input.startAt.getTime() + 60 * 60_000);
    const response = await this.fetcher(eventUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: eventId,
        summary: input.title,
        ...(input.description ? { description: input.description } : {}),
        ...(input.location ? { location: input.location } : {}),
        start: {
          dateTime: input.startAt.toISOString(),
          timeZone: input.timezone,
        },
        end: { dateTime: endAt.toISOString(), timeZone: input.timezone },
        colorId: input.colorId ?? GOOGLE_CALENDAR_MANGO_COLOR_ID,
        extendedProperties: {
          private: { watcherExternalEventId: input.externalId },
        },
      }),
      ...(signal ? { signal } : {}),
    });
    if (response.status === 403) {
      throw new Error(
        'Google Calendar write access is missing; reconnect Calendar',
      );
    }
    if (response.status === 409) {
      const existingUrl = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
      );
      const existing = createdEventSchema.parse(
        await responseJson(
          await this.fetcher(existingUrl, {
            headers: { authorization: `Bearer ${accessToken}` },
            ...(signal ? { signal } : {}),
          }),
        ),
      );
      return {
        id: existing.id,
        ...(existing.htmlLink ? { htmlLink: existing.htmlLink } : {}),
        duplicate: true,
      };
    }
    const created = createdEventSchema.parse(await responseJson(response));
    return {
      id: created.id,
      ...(created.htmlLink ? { htmlLink: created.htmlLink } : {}),
      duplicate: false,
    };
  }

  public async listEvents(
    telegramChatId: bigint,
    input: {
      start: Date;
      end: Date;
      timezone: string;
      includeOccasionCalendars?: boolean;
    },
    signal?: AbortSignal,
  ): Promise<CalendarEvent[]> {
    if (input.end <= input.start) throw new Error('Invalid Calendar window');
    const integration = await this.integrations.get(telegramChatId);
    if (!integration?.connected) {
      throw new Error('Google Calendar is not connected');
    }
    const accessToken = await this.oauth.accessToken(telegramChatId);
    const events: CalendarEvent[] = [];
    const calendarIds = input.includeOccasionCalendars
      ? await this.withOccasionCalendarIds(
          integration.calendarIds,
          accessToken,
          signal,
        )
      : integration.calendarIds;
    for (const calendarId of calendarIds) {
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
            ...(event.eventType ? { eventType: event.eventType } : {}),
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

  private async withOccasionCalendarIds(
    configuredIds: readonly string[],
    accessToken: string,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const ids = new Set(configuredIds);
    let pageToken: string | undefined;
    let page = 0;
    do {
      const url = new URL(
        'https://www.googleapis.com/calendar/v3/users/me/calendarList',
      );
      url.searchParams.set('maxResults', '250');
      url.searchParams.set('minAccessRole', 'reader');
      url.searchParams.set('showDeleted', 'false');
      url.searchParams.set('showHidden', 'true');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const response = calendarListResponseSchema.parse(
        await responseJson(
          await this.fetcher(url, {
            headers: { authorization: `Bearer ${accessToken}` },
            ...(signal ? { signal } : {}),
          }),
        ),
      );
      for (const calendar of response.items ?? []) {
        if (calendar.deleted) continue;
        const label = `${calendar.summary ?? ''} ${calendar.id}`;
        if (
          /birthday|narozenin|narozky|jmeniny|name[\s-]?days?/iu.test(label)
        ) {
          ids.add(calendar.id);
        }
      }
      pageToken = response.nextPageToken;
      page += 1;
      if (page >= 10 && pageToken) {
        throw new Error('Google Calendar list pagination limit exceeded');
      }
    } while (pageToken);
    return [...ids];
  }
}
