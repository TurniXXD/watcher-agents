import { beforeAll, describe, expect, it, vi } from 'vitest';

describe('website revalidation webhook', () => {
  beforeAll(() => {
    vi.stubEnv('DATABASE_URI', 'postgresql://u:p@h/db');
    vi.stubEnv('PAYLOAD_SECRET', 'x'.repeat(32));
    vi.stubEnv(
      'REVALIDATE_WEBHOOK_URL',
      'https://site.example.test/api/revalidate',
    );
    vi.stubEnv('REVALIDATE_WEBHOOK_SECRET', 's'.repeat(32));
  });

  it('retries transient failures with bounded attempts and sends the secret only in a header', async () => {
    const { requestRevalidation } = await import('../lib/revalidate');
    vi.useFakeTimers();
    const logger = { warn: vi.fn() };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const done = requestRevalidation(
      { logger } as never,
      ['events', 'events', 'events:x'],
      fetchMock,
    );
    await vi.runAllTimersAsync();
    await done;
    vi.useRealTimers();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://site.example.test/api/revalidate');
    expect(JSON.parse(init?.body as string)).toEqual({
      tags: ['events', 'events:x'],
    });
    expect(
      (init?.headers as Record<string, string>)['X-Revalidate-Secret'],
    ).toHaveLength(32);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('gives up after three failed attempts and logs without throwing', async () => {
    const { requestRevalidation } = await import('../lib/revalidate');
    vi.useFakeTimers();
    const logger = { warn: vi.fn() };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('offline'));
    const done = requestRevalidation(
      { logger } as never,
      ['events'],
      fetchMock,
    );
    await vi.runAllTimersAsync();
    await done;
    vi.useRealTimers();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
