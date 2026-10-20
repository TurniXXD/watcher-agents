import { describe, expect, it, vi } from 'vitest';
import type { SocialsStore } from '@watcher/database';
import type {
  CalendarEventWrite,
  CreatedCalendarEvent,
} from '@watcher/google-calendar';
import { hasComplimentaryFoodEvidence, NetworkingService } from '../service.js';

const event = (
  title: string,
  description: string,
  priceStatus: 'FREE' | 'PAID' | 'UNKNOWN',
) => ({
  id: title,
  title,
  description,
  priceStatus,
  relevanceScore: 50,
  startAt: new Date('2026-10-21T15:00:00Z'),
});

describe('networking event discovery', () => {
  it('uses Prague day boundaries and excludes purely online records', async () => {
    const store = {
      ensureSettings: vi.fn().mockResolvedValue({
        preferredCities: ['Brno'],
        weeklyRecommendationCount: 5,
      }),
      importBrnoEvents: vi.fn().mockResolvedValue(0),
      listNetworkingEvents: vi.fn().mockResolvedValue([]),
    };
    const service = new NetworkingService(
      store as unknown as SocialsStore,
      'Europe/Prague',
    );

    await service.discoverEvents(1n, 2n, {
      range: 'TODAY',
      now: new Date('2026-10-19T13:00:00Z'),
    });

    expect(store.importBrnoEvents).toHaveBeenCalledWith(
      1n,
      new Date('2026-10-19T13:00:00Z'),
      new Date('2026-10-19T21:59:59.999Z'),
    );
    expect(store.listNetworkingEvents).toHaveBeenCalledWith(
      expect.objectContaining({ inPersonOnly: true }),
    );
  });

  it('returns only this week events with grounded complimentary food evidence', async () => {
    const matching = event(
      'Founders evening',
      'Vstup je zdarma. Čeká vás drobné občerstvení.',
      'FREE',
    );
    const store = {
      ensureSettings: vi.fn().mockResolvedValue({
        preferredCities: ['Brno'],
        weeklyRecommendationCount: 5,
      }),
      importBrnoEvents: vi.fn().mockResolvedValue(3),
      listNetworkingEvents: vi
        .fn()
        .mockResolvedValue([
          matching,
          event('Paid buffet', 'Občerstvení je k zakoupení.', 'PAID'),
          event('Talk', 'No catering information.', 'FREE'),
        ]),
    };
    const service = new NetworkingService(
      store as unknown as SocialsStore,
      'Europe/Prague',
    );

    const result = await service.discoverEvents(1n, 2n, {
      range: 'THIS_WEEK',
      freeFoodOnly: true,
      now: new Date('2026-10-19T13:00:00Z'),
    });

    expect(result).toEqual([matching]);
    expect(store.importBrnoEvents).toHaveBeenCalledWith(
      1n,
      new Date('2026-10-19T13:00:00Z'),
      new Date('2026-10-25T22:59:59.999Z'),
    );
  });
});

describe('complimentary food evidence', () => {
  it('accepts explicit included catering and rejects paid refreshments', () => {
    expect(
      hasComplimentaryFoodEvidence(
        event('Conference', 'Lunch is included in admission.', 'PAID'),
      ),
    ).toBe(true);
    expect(
      hasComplimentaryFoodEvidence(
        event('Conference', 'Snacks are available for purchase.', 'FREE'),
      ),
    ).toBe(false);
  });
});

describe('Google Calendar event writes', () => {
  it('re-checks ownership and carries a required registration link into a mango event', async () => {
    const calendarEvent = {
      id: 'google-event',
      htmlLink: 'https://calendar.google.com/event?eid=test',
      duplicate: false,
    };
    const createEvent = vi
      .fn<
        (
          chatId: bigint,
          input: CalendarEventWrite,
          signal?: AbortSignal,
        ) => Promise<CreatedCalendarEvent>
      >()
      .mockResolvedValue(calendarEvent);
    const calendar = { createEvent };
    const storedEvent = {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Validation Camp',
      description: 'Praktický workshop.',
      startAt: new Date('2026-10-21T15:00:00Z'),
      endAt: new Date('2026-10-21T17:00:00Z'),
      timezone: 'Europe/Prague',
      venue: 'Impact Hub',
      address: 'Cyrilská 7',
      city: 'Brno',
      accessType: 'REGISTRATION_REQUIRED',
      registrationUrl: 'https://example.com/register',
      canonicalUrl: 'https://example.com/event',
      sourceReferences: [],
    };
    const store = {
      getNetworkingEvent: vi.fn().mockResolvedValue(storedEvent),
    };
    const service = new NetworkingService(
      store as unknown as SocialsStore,
      'Europe/Prague',
      calendar,
    );

    await expect(
      service.addEventToCalendar(7n, 8n, storedEvent.id),
    ).resolves.toEqual({ event: storedEvent, calendarEvent });
    expect(store.getNetworkingEvent).toHaveBeenCalledWith(7n, storedEvent.id);
    expect(calendar.createEvent).toHaveBeenCalledWith(
      8n,
      expect.objectContaining({
        externalId: storedEvent.id,
        colorId: '6',
        location: 'Impact Hub, Cyrilská 7, Brno',
      }),
      expect.any(AbortSignal),
    );
    expect(createEvent.mock.calls[0]?.[1].description).toContain(
      'Registrace: https://example.com/register',
    );
  });

  it('does not expose an event owned by another operator', async () => {
    const calendar = { createEvent: vi.fn() };
    const store = { getNetworkingEvent: vi.fn().mockResolvedValue(null) };
    const service = new NetworkingService(
      store as unknown as SocialsStore,
      'Europe/Prague',
      calendar,
    );

    await expect(
      service.addEventToCalendar(
        7n,
        8n,
        '11111111-1111-4111-8111-111111111111',
      ),
    ).rejects.toThrow('not found');
    expect(calendar.createEvent).not.toHaveBeenCalled();
  });
});
