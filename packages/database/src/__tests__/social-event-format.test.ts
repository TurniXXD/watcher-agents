import { describe, expect, it } from 'vitest';
import { classifySocialEventFormat } from '../socials-store.js';

describe('social networking event format', () => {
  it('separates online, hybrid, and in-person events', () => {
    expect(
      classifySocialEventFormat({
        title: 'Online webinar',
        description: null,
        venueName: 'Zoom',
        venueAddress: null,
      }),
    ).toBe('ONLINE');
    expect(
      classifySocialEventFormat({
        title: 'Hybrid founders meetup',
        description: 'Připojit se lze přes Zoom.',
        venueName: 'Impact Hub Brno',
        venueAddress: 'Cyrilská 7, Brno',
      }),
    ).toBe('HYBRID');
    expect(
      classifySocialEventFormat({
        title: 'Křest knihy',
        description: 'Fotografie mohou být později zveřejněny online.',
        venueName: 'Impact Hub Brno',
        venueAddress: 'Cyrilská 7, Brno',
      }),
    ).toBe('IN_PERSON');
  });
});
