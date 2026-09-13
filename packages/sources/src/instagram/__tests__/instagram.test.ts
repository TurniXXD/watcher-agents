import { afterEach, describe, expect, it, vi } from 'vitest';
import { CachedInstagramClient } from '../client.js';
import {
  deduplicateInstagramPosts,
  normalizeInstagramUsername,
} from '../normalizer.js';
import { parseInstagramHtml } from '../parser.js';
import { InstagramPublicProvider } from '../public-provider.js';
import type { InstagramProvider } from '../types.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('Instagram normalization', () => {
  it('normalizes usernames from supported URL forms', () => {
    expect(
      normalizeInstagramUsername('https://www.instagram.com/Foo.Bar/?hl=cs'),
    ).toBe('foo.bar');
    expect(normalizeInstagramUsername('@Foo_Bar')).toBe('foo_bar');
  });

  it('deduplicates posts by account and shortcode', () => {
    const post = {
      id: '1',
      shortcode: 'abc',
      account: { username: 'club' },
      url: 'https://www.instagram.com/p/abc/',
    };
    expect(
      deduplicateInstagramPosts([post, { ...post, id: '2' }]),
    ).toHaveLength(1);
  });

  it('parses embedded profile and post JSON without DOM selectors', () => {
    const html = `<script type="application/json">${JSON.stringify({ user: { username: 'club', full_name: 'Club', biography: 'Bio', is_private: false, bio_links: [{ title: 'Events', url: 'https://example.com/events' }], edge_owner_to_timeline_media: { edges: [{ node: { id: '10', shortcode: 'xyz', taken_at_timestamp: 1_700_000_000, __typename: 'GraphImage', edge_media_to_caption: { edges: [{ node: { text: ' Workshop  tomorrow ' } }] } } }] } } })}</script>`;
    const parsed = parseInstagramHtml('club', html);
    expect(parsed.profile.externalLinks).toEqual([
      { title: 'Events', url: 'https://example.com/events' },
    ]);
    expect(parsed.posts[0]).toMatchObject({
      id: '10',
      shortcode: 'xyz',
      caption: 'Workshop tomorrow',
      mediaType: 'image',
    });
  });

  it('caches repeated post requests', async () => {
    const getRecentPosts = vi.fn(async () => [
      {
        id: '1',
        account: { username: 'club' },
        caption: 'Event',
        url: 'https://www.instagram.com/p/a/',
      },
    ]);
    const provider: InstagramProvider = { getProfile: vi.fn(), getRecentPosts };
    const client = new CachedInstagramClient(provider, {
      minimumRequestIntervalMs: 0,
    });
    await client.getRecentPosts('club');
    await client.getRecentPosts('club');
    expect(getRecentPosts).toHaveBeenCalledOnce();
  });

  it('retries a transient public profile request', async () => {
    vi.useFakeTimers();
    const html = `<script type="application/json">${JSON.stringify({ user: { username: 'club', full_name: 'Club', is_private: false } })}</script>`;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response(html));
    const pending = new InstagramPublicProvider(fetcher).getProfile('club');
    const assertion = expect(pending).resolves.toMatchObject({
      username: 'club',
    });
    await vi.runAllTimersAsync();

    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
