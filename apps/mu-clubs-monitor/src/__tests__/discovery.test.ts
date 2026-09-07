import { describe, expect, it } from 'vitest';
import { discoverOfficialLinks } from '../discovery.js';

describe('club source discovery', () => {
  it('extracts external public channels and never registers MUNI profile links', () => {
    const sources = discoverOfficialLinks(
      '<a href="https://instagram.com/Club.Name/?hl=cs">Instagram</a><a href="https://example.org/events">Web</a><a href="/portal-pro-studujici/other">MUNI</a>',
      'https://www.muni.cz/portal-pro-studujici/club',
    );
    expect(sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'INSTAGRAM',
          username: 'club.name',
          url: 'https://www.instagram.com/club.name/',
        }),
        expect.objectContaining({
          type: 'WEBSITE',
          url: 'https://example.org/events',
        }),
      ]),
    );
    expect(sources.some(({ url }) => url?.includes('muni.cz'))).toBe(false);
  });
});
