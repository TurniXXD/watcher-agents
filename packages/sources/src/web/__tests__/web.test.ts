import { describe, expect, it, vi } from 'vitest';
import { discoverSourceLinks } from '../discovery.js';
import { extractHtmlLinks } from '../html.js';
import { fetchPublicHtml } from '../public-html.js';

describe('shared public web sources', () => {
  it('extracts normalized links and readable labels', () => {
    expect(
      extractHtmlLinks(
        '<a href="/events"><strong>New&nbsp;events</strong></a>',
        'https://club.example/about',
      ),
    ).toEqual([{ url: 'https://club.example/events', text: 'New events' }]);
  });

  it('discovers reusable source kinds and excludes directory hosts', () => {
    const sources = discoverSourceLinks(
      '<a href="https://instagram.com/Foo.Bar/?hl=cs">Instagram</a><a href="/profile">Profile</a><a href="https://example.com/feed.xml">Feed</a>',
      'https://www.muni.cz/club',
      { excludeHostnames: ['muni.cz'] },
    );
    expect(sources).toEqual([
      {
        type: 'INSTAGRAM',
        username: 'foo.bar',
        url: 'https://www.instagram.com/foo.bar/',
      },
      { type: 'RSS', url: 'https://example.com/feed.xml' },
    ]);
  });

  it('validates every redirect and returns bounded HTML', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: '/current' },
        }),
      )
      .mockResolvedValueOnce(
        new Response('<p>activity</p>', {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
      );
    const resolvePublicUrl = vi.fn(async (url: string) => new URL(url));
    await expect(
      fetchPublicHtml('https://club.example/old', {
        fetcher,
        maximumBytes: 8,
        resolvePublicUrl,
      }),
    ).resolves.toEqual({
      html: '<p>activ',
      url: 'https://club.example/current',
    });
    expect(resolvePublicUrl).toHaveBeenCalledTimes(2);
  });
});
