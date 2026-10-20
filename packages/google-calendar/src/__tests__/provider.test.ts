import type { CalendarIntegrationStore } from '@watcher/database';
import { describe, expect, it, vi } from 'vitest';
import type { GoogleCalendarOAuth } from '../oauth.js';
import {
  GOOGLE_CALENDAR_MANGO_COLOR_ID,
  GoogleCalendarProvider,
} from '../provider.js';

const response = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('GoogleCalendarProvider event writes', () => {
  it('creates a mango event with a deterministic id and no guest updates', async () => {
    const bodies: Record<string, unknown>[] = [];
    const urls: URL[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      urls.push(
        input instanceof URL
          ? input
          : new URL(typeof input === 'string' ? input : input.url),
      );
      if (typeof init?.body !== 'string') throw new Error('Missing JSON body');
      const parsed = JSON.parse(init.body) as unknown;
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid JSON body');
      }
      bodies.push(parsed as Record<string, unknown>);
      return response({
        id: 'created-event',
        htmlLink: 'https://calendar.google.com/event?eid=created',
      });
    });
    const oauth = {
      accessToken: vi.fn(async () => 'access-token'),
    } as unknown as GoogleCalendarOAuth;
    const integrations: Pick<CalendarIntegrationStore, 'get'> = {
      get: vi.fn(async () => ({
        connected: true,
        calendarIds: ['primary'],
      })),
    };
    const provider = new GoogleCalendarProvider(oauth, integrations, fetcher);

    await expect(
      provider.createEvent(42n, {
        externalId: '11111111-1111-4111-8111-111111111111',
        title: 'Networking event',
        description: 'Registrace: https://example.com/register',
        startAt: new Date('2026-10-21T15:00:00Z'),
        endAt: new Date('2026-10-21T17:00:00Z'),
        timezone: 'Europe/Prague',
      }),
    ).resolves.toEqual({
      id: 'created-event',
      htmlLink: 'https://calendar.google.com/event?eid=created',
      duplicate: false,
    });
    expect(urls[0]?.searchParams.get('sendUpdates')).toBe('none');
    expect(bodies[0]).toMatchObject({
      summary: 'Networking event',
      colorId: GOOGLE_CALENDAR_MANGO_COLOR_ID,
      description: 'Registrace: https://example.com/register',
    });
    expect(bodies[0]?.id).toMatch(/^e[0-9a-f]{64}$/u);
  });

  it('returns an existing deterministic event after a retry conflict', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ error: 'duplicate' }, 409))
      .mockResolvedValueOnce(
        response({
          id: 'existing-event',
          htmlLink: 'https://calendar.google.com/event?eid=existing',
        }),
      );
    const provider = new GoogleCalendarProvider(
      {
        accessToken: vi.fn(async () => 'access-token'),
      } as unknown as GoogleCalendarOAuth,
      {
        get: vi.fn(async () => ({
          connected: true,
          calendarIds: ['primary'],
        })),
      },
      fetcher,
    );

    await expect(
      provider.createEvent(42n, {
        externalId: 'event-id',
        title: 'Networking event',
        startAt: new Date('2026-10-21T15:00:00Z'),
        timezone: 'Europe/Prague',
      }),
    ).resolves.toMatchObject({
      id: 'existing-event',
      duplicate: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
