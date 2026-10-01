import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { fetchPublicJson } from '../collectors/public-json.js';

describe('public JSON fetching', () => {
  it('validates every redirect target before following it', async () => {
    const resolvePublicUrl = vi.fn(async (value: string) => {
      const url = new URL(value);
      if (url.hostname === '127.0.0.1')
        throw new Error('Private network target blocked');
      return url;
    });
    const fetcher = vi.fn(async () =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1/internal' },
        }),
      ),
    );

    await expect(
      fetchPublicJson(
        'https://public.example/data',
        z.object({ ok: z.boolean() }),
        {
          fetcher,
          resolvePublicUrl,
        },
      ),
    ).rejects.toThrow(/Private network/);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(resolvePublicUrl).toHaveBeenCalledWith('http://127.0.0.1/internal');
  });

  it('enforces the response schema', async () => {
    await expect(
      fetchPublicJson(
        'https://public.example/data',
        z.object({ ok: z.boolean() }),
        {
          fetcher: async () =>
            new Response(JSON.stringify({ ok: 'not-a-boolean' }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          resolvePublicUrl: async (value) => new URL(value),
        },
      ),
    ).rejects.toThrow();
  });
});
