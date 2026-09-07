import type { CalendarIntegrationStore } from '@watcher/database';
import { describe, expect, it, vi } from 'vitest';
import {
  CalendarCredentialCipher,
  GoogleCalendarOAuth,
} from '../calendar-oauth.js';
import {
  calendarActionInsights,
  calendarDayWindow,
  GoogleCalendarProvider,
  renderCalendarSummary,
} from '../calendar.js';
import { oauthCallbackPathFromRedirectUri } from '../oauth-callback-server.js';

const jsonResponse = (value: unknown): Response =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const encryptionKey = Buffer.alloc(32, 7).toString('base64');

describe('Google Calendar integration', () => {
  it('isolates the callback at the bot-specific path from the redirect URI', () => {
    expect(
      oauthCallbackPathFromRedirectUri(
        'https://api.example.com/briefing-bot/oauth/google/callback',
      ),
    ).toBe('/briefing-bot/oauth/google/callback');
    expect(() =>
      oauthCallbackPathFromRedirectUri('https://api.example.com'),
    ).toThrow(/callback path/);
    expect(() =>
      oauthCallbackPathFromRedirectUri(
        'https://api.example.com/briefing-bot/oauth/google/callback?tenant=one',
      ),
    ).toThrow(/query or hash/);
  });

  it('encrypts refresh tokens with authenticated encryption', () => {
    const cipher = new CalendarCredentialCipher(encryptionKey);
    const encrypted = cipher.encrypt('refresh-secret');
    const parts = encrypted.split('.');
    const ciphertext = Buffer.from(parts[3]!, 'base64url');
    ciphertext[0] = ciphertext[0]! ^ 1;
    parts[3] = ciphertext.toString('base64url');

    expect(encrypted).not.toContain('refresh-secret');
    expect(cipher.decrypt(encrypted)).toBe('refresh-secret');
    expect(() => cipher.decrypt(parts.join('.'))).toThrow();
  });

  it('uses state-bound offline OAuth and never persists a plaintext token', async () => {
    let encryptedRefreshToken: string | undefined;
    const beginAuthorization = vi.fn<
      (chatId: bigint, stateHash: string, expiresAt: Date) => Promise<void>
    >(async () => undefined);
    const completeAuthorization = vi.fn<
      (stateHash: string, token: string) => Promise<bigint>
    >(async (_stateHash: string, token: string) => {
      encryptedRefreshToken = token;
      return 42n;
    });
    const store: Pick<
      CalendarIntegrationStore,
      'beginAuthorization' | 'completeAuthorization' | 'get' | 'markRefreshed'
    > = {
      beginAuthorization,
      completeAuthorization,
      get: vi.fn(async () => ({
        connected: true,
        ...(encryptedRefreshToken ? { encryptedRefreshToken } : {}),
        calendarIds: ['primary'],
      })),
      markRefreshed: vi.fn(async () => undefined),
    };
    const requests: URLSearchParams[] = [];
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      requests.push(init?.body as URLSearchParams);
      return jsonResponse(
        requests.length === 1
          ? { access_token: 'temporary', refresh_token: 'refresh-secret' }
          : { access_token: 'access-secret', expires_in: 3600 },
      );
    });
    const oauth = new GoogleCalendarOAuth(
      {
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri:
          'https://watcher.example/briefing-bot/oauth/google/callback',
      },
      store,
      new CalendarCredentialCipher(encryptionKey),
      fetcher,
    );

    const authorizationUrl = new URL(await oauth.authorizationUrl(42n));
    const state = authorizationUrl.searchParams.get('state')!;
    expect(authorizationUrl.origin).toBe('https://accounts.google.com');
    expect(authorizationUrl.searchParams.get('access_type')).toBe('offline');
    expect(authorizationUrl.searchParams.get('scope')).toBe(
      'https://www.googleapis.com/auth/calendar.readonly',
    );
    expect(beginAuthorization.mock.calls[0]?.[1]).not.toBe(state);

    await expect(oauth.completeCallback('code', state)).resolves.toBe(42n);
    expect(encryptedRefreshToken).toBeDefined();
    expect(encryptedRefreshToken).not.toContain('refresh-secret');
    await expect(oauth.accessToken(42n)).resolves.toBe('access-secret');
    expect(requests[1]?.get('refresh_token')).toBe('refresh-secret');
  });

  it('normalizes event pages without retaining descriptions', async () => {
    const requested: URL[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url =
        input instanceof URL
          ? input
          : new URL(typeof input === 'string' ? input : input.url);
      requested.push(url);
      return jsonResponse({
        summary: 'Primary',
        items: [
          {
            id: 'meeting-1',
            summary: 'Planning',
            description: 'Private notes must not leave the adapter',
            location: 'Office',
            start: { dateTime: '2026-03-29T09:00:00+02:00' },
            end: { dateTime: '2026-03-29T10:00:00+02:00' },
          },
          {
            id: 'cancelled',
            status: 'cancelled',
            start: { date: '2026-03-29' },
            end: { date: '2026-03-30' },
          },
        ],
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
    const window = calendarDayWindow(
      new Date('2026-03-29T10:00:00.000Z'),
      'Europe/Prague',
    );

    await expect(
      provider.listEvents(42n, { ...window, timezone: 'Europe/Prague' }),
    ).resolves.toEqual([
      {
        id: 'meeting-1',
        title: 'Planning',
        start: '2026-03-29T09:00:00+02:00',
        end: '2026-03-29T10:00:00+02:00',
        allDay: false,
        location: 'Office',
        calendarName: 'Primary',
      },
    ]);
    expect(window.start.toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-03-29T22:00:00.000Z');
    expect(requested[0]?.searchParams.get('singleEvents')).toBe('true');
    expect(requested[0]?.searchParams.get('orderBy')).toBe('startTime');
    expect(renderCalendarSummary([])).toBe('Your calendar is clear today.');
  });

  it('turns calendar pressure into concise preparation actions', () => {
    expect(
      calendarActionInsights([
        {
          id: 'one',
          title: 'Project review',
          start: '2026-09-07T08:00:00+02:00',
          end: '2026-09-07T09:00:00+02:00',
          allDay: false,
          location: 'Office',
        },
        {
          id: 'two',
          title: 'Submission deadline',
          start: '2026-09-07T08:55:00+02:00',
          end: '2026-09-07T10:00:00+02:00',
          allDay: false,
          location: 'Campus',
        },
      ]),
    ).toEqual([
      'Prepare for Project review before it starts.',
      'Do not miss Submission deadline.',
      'Project review overlaps with Submission deadline.',
      'Allow travel time from Office to Campus.',
    ]);
  });
});
