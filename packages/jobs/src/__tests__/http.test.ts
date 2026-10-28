import { describe, expect, it, vi } from 'vitest';
import { fetchJobSource, verifyJobAvailability } from '../index.js';

describe('job source HTTP client', () => {
  it('retries HTTP 429 and honors Retry-After', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('rate limited', {
          status: 429,
          headers: { 'retry-after': '0' },
        }),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const response = await fetchJobSource('https://8.8.8.8/jobs', {
      accept: 'application/json',
      fetcher,
    });
    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('sets conditional request headers', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 304 }));
    await fetchJobSource('https://8.8.8.8/jobs', {
      accept: 'application/json',
      checkpoint: {
        etag: '"one"',
        lastModified: 'Mon, 19 Oct 2026 08:00:00 GMT',
      },
      fetcher,
    });
    const init = fetcher.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get('if-none-match')).toBe('"one"');
    expect(headers.get('if-modified-since')).toContain('19 Oct 2026');
  });

  it('blocks redirects to private network addresses', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1/internal' },
      }),
    );
    await expect(
      fetchJobSource('https://8.8.8.8/jobs', {
        accept: 'text/html',
        fetcher,
        attempts: 1,
      }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('confirms availability only from explicit employer-page evidence', async () => {
    const open = await verifyJobAvailability(
      'https://8.8.8.8/job',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response('<button>Apply for this job</button>', { status: 200 }),
        ),
    );
    const unverified = await verifyJobAvailability(
      'https://8.8.8.8/job',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response('<h1>Software engineer</h1>', { status: 200 }),
        ),
    );
    const closed = await verifyJobAvailability(
      'https://8.8.8.8/job',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('gone', { status: 410 })),
    );
    expect({ open, unverified, closed }).toEqual({
      open: 'OPEN_CONFIRMED',
      unverified: 'LISTED_UNVERIFIED',
      closed: 'CLOSED_CONFIRMED',
    });
  });

  it('recognizes the Greenhouse expired-job response', async () => {
    await expect(
      verifyJobAvailability(
        'https://8.8.8.8/job',
        vi.fn<typeof fetch>().mockResolvedValue(
          new Response('The job you are looking for is no longer open.', {
            status: 200,
          }),
        ),
      ),
    ).resolves.toBe('CLOSED_CONFIRMED');
  });

  it('recognizes explicit Czech open and expired vacancy evidence', async () => {
    const open = await verifyJobAvailability(
      'https://8.8.8.8/job',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response('<button>Odpovědět na nabídku</button>'),
        ),
    );
    const closed = await verifyJobAvailability(
      'https://8.8.8.8/job',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('Tato nabídka již není aktuální.')),
    );

    expect({ open, closed }).toEqual({
      open: 'OPEN_CONFIRMED',
      closed: 'CLOSED_CONFIRMED',
    });
  });

  it('recognizes Greenhouse expired pages from their canonical error URL', async () => {
    await expect(
      verifyJobAvailability(
        'https://8.8.8.8/job',
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(
            new Response(
              '<link rel="canonical" href="https://job-boards.greenhouse.io/example?error=true">',
              { status: 200 },
            ),
          ),
      ),
    ).resolves.toBe('CLOSED_CONFIRMED');
  });
});
