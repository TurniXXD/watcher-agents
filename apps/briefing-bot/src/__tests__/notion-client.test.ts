import { describe, expect, it, vi } from 'vitest';
import { NotionClient } from '../notion-client.js';
import type { NotionApiError } from '../notion-client.js';

describe('NotionClient', () => {
  it('retries rate limits using Retry-After without exposing response data', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: 'rate_limited', message: 'slow down' }),
          { status: 429, headers: { 'retry-after': '2' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ results: [], has_more: false, next_cursor: null }),
          { status: 200 },
        ),
      );
    const sleep = vi.fn(() => Promise.resolve());
    const client = new NotionClient({
      apiKey: 'secret',
      fetch: fetcher,
      sleep,
    });

    await expect(client.queryDataSource('source', {})).resolves.toMatchObject({
      results: [],
    });
    expect(sleep).toHaveBeenCalledWith(2_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('returns a typed error after a non-retryable API failure', async () => {
    const client = new NotionClient({
      apiKey: 'secret',
      fetch: vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ code: 'unauthorized', message: 'bad token' }),
            { status: 401 },
          ),
        ),
      ),
    });

    await expect(client.listBlockChildren('page')).rejects.toEqual(
      expect.objectContaining<Partial<NotionApiError>>({
        status: 401,
        code: 'unauthorized',
      }),
    );
  });
});
