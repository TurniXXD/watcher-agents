import { assertPublicHttpUrl } from '@watcher/core';
import type { SocialsStore } from '@watcher/database';
import {
  GOOGLE_CALENDAR_MANGO_COLOR_ID,
  type GoogleCalendarProvider,
} from '@watcher/google-calendar';
import { localDayWindow, localWeekWindow } from './time.js';

export type EventDiscoveryOptions = {
  freeOnly?: boolean;
  freeFoodOnly?: boolean;
  now?: Date;
  range?: 'NEXT_EIGHT_DAYS' | 'TODAY' | 'THIS_WEEK';
};

const normalized = (value: string): string =>
  value
    .normalize('NFKD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLowerCase();

export const hasComplimentaryFoodEvidence = (event: {
  title: string;
  description: string | null;
  priceStatus: 'FREE' | 'PAID' | 'UNKNOWN';
}): boolean => {
  const text = normalized(`${event.title} ${event.description ?? ''}`);
  const food =
    '(?:jidlo|obcerstveni|catering|snacks?|refreshments?|snidane|obed|vecere|breakfast|lunch|dinner)';
  const complimentary =
    '(?:zdarma|bezplatn\\w*|v cene|zajisten\\w*|provided|included|complimentary|free)';
  if (
    new RegExp(`${food}[^.!?\\n]{0,35}${complimentary}`, 'u').test(text) ||
    new RegExp(`${complimentary}[^.!?\\n]{0,35}${food}`, 'u').test(text)
  )
    return true;
  return (
    event.priceStatus === 'FREE' &&
    /(?:drobne |male )?obcerstveni|catering|refreshments?|snacks?/u.test(
      text,
    ) &&
    !/(?:no|without) (?:catering|refreshments?|snacks?)|(?:bez|zadne) obcerstveni|obcerstveni (?:neni|nebude)/u.test(
      text,
    ) &&
    !/(?:obcerstveni|catering|refreshments?|snacks?)[^.!?\n]{0,20}(?:za poplatek|placen|k zakoupeni|for purchase)/u.test(
      text,
    )
  );
};

export class NetworkingService {
  public constructor(
    private readonly store: SocialsStore,
    private readonly timezone = 'Europe/Prague',
    private readonly calendar?: Pick<GoogleCalendarProvider, 'createEvent'>,
  ) {}

  public async discoverEvents(
    ownerUserId: bigint,
    chatId: bigint,
    options?: EventDiscoveryOptions,
  ) {
    const settings = await this.store.ensureSettings(ownerUserId, chatId);
    const now = options?.now ?? new Date();
    const window =
      options?.range === 'TODAY'
        ? localDayWindow(now, this.timezone)
        : options?.range === 'THIS_WEEK'
          ? localWeekWindow(now, this.timezone)
          : {
              from: now,
              to: new Date(now.getTime() + 8 * 24 * 60 * 60_000),
            };
    await this.store.importBrnoEvents(ownerUserId, window.from, window.to);
    const events = await this.store.listNetworkingEvents({
      ownerUserId,
      from: window.from,
      to: window.to,
      cities: settings.preferredCities,
      ...(options?.freeOnly === undefined
        ? {}
        : { freeOnly: options.freeOnly }),
      inPersonOnly: true,
      limit: 100,
    });
    return events
      .filter(
        (event) =>
          !options?.freeFoodOnly || hasComplimentaryFoodEvidence(event),
      )
      .sort(
        (left, right) =>
          Number(right.priceStatus === 'FREE') -
            Number(left.priceStatus === 'FREE') ||
          right.relevanceScore - left.relevanceScore ||
          left.startAt.getTime() - right.startAt.getTime(),
      )
      .slice(0, settings.weeklyRecommendationCount);
  }

  public addManualEvent(input: {
    ownerUserId: bigint;
    title: string;
    startAt: Date;
    city?: string;
    sourceUrl: string;
    priceStatus?: 'FREE' | 'PAID' | 'UNKNOWN';
  }) {
    const sourceUrl = assertPublicHttpUrl(input.sourceUrl).toString();
    return this.store.addManualEvent({ ...input, sourceUrl });
  }

  public async addEventToCalendar(
    ownerUserId: bigint,
    telegramChatId: bigint,
    eventId: string,
  ) {
    if (!this.calendar) {
      throw new Error('Google Calendar is not configured');
    }
    const event = await this.store.getNetworkingEvent(ownerUserId, eventId);
    if (!event) throw new Error('Networking event not found');
    const sourceUrl = event.canonicalUrl;
    const description = [
      event.description?.trim(),
      event.accessType === 'REGISTRATION_REQUIRED' && event.registrationUrl
        ? `Registrace: ${event.registrationUrl}`
        : undefined,
      sourceUrl ? `Zdroj: ${sourceUrl}` : undefined,
    ]
      .filter(Boolean)
      .join('\n\n');
    const location = [event.venue, event.address, event.city]
      .filter(Boolean)
      .join(', ');
    const calendarEvent = await this.calendar.createEvent(
      telegramChatId,
      {
        externalId: event.id,
        title: event.title,
        startAt: event.startAt,
        ...(event.endAt ? { endAt: event.endAt } : {}),
        timezone: event.timezone || this.timezone,
        ...(location ? { location } : {}),
        ...(description ? { description } : {}),
        colorId: GOOGLE_CALENDAR_MANGO_COLOR_ID,
      },
      AbortSignal.timeout(15_000),
    );
    return { event, calendarEvent };
  }
}
