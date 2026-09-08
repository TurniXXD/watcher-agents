import { describe, expect, it, vi } from 'vitest';
import { JsonLdEventSource } from '../sources/json-ld.js';
import { createSources, type SourceSettings } from '../sources/registry.js';

const fixture = `<!doctype html><script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Event",
  "@id": "fixture-event",
  "name": "Brno AI workshop",
  "description": "Practical programming workshop in Brno",
  "startDate": "2026-09-10T18:00:00+02:00",
  "url": "/events/fixture",
  "location": { "@type": "Place", "name": "JIC", "address": { "addressLocality": "Brno" } }
}
</script>`;

const settings = Object.fromEntries(
  ['meetup', 'goout', 'visitbrno', 'muni', 'vut', 'jic', 'ceitec'].map((id) => [
    id,
    { interval: 60, enabled: true },
  ]),
) as SourceSettings;

describe('Brno event sources', () => {
  it('registers every v1 source with independent polling configuration', () => {
    expect(createSources(settings).map((source) => source.id)).toEqual([
      'meetup',
      'goout',
      'visitbrno',
      'muni',
      'vut',
      'jic',
      'ceitec',
    ]);
  });

  it.each(createSources(settings).map((source) => source.id))(
    '%s normalizes its structured Event payload',
    async (sourceId) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(fixture, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      );
      const source = new JsonLdEventSource(
        sourceId,
        sourceId,
        `https://${sourceId}.example.test/list`,
        60,
        true,
        ['other'],
        fetcher,
      );

      const events = await source.fetchUpcomingEvents({
        now: new Date('2026-09-08T00:00:00Z'),
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        externalId: 'fixture-event',
        title: 'Brno AI workshop',
        eventUrl: `https://${sourceId}.example.test/events/fixture`,
      });
    },
  );

  it('does not invent events from malformed structured data', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('<script type="application/ld+json">{broken</script>'),
      );
    const source = new JsonLdEventSource(
      'malformed',
      'Malformed fixture',
      'https://malformed.example.test',
      60,
      true,
      ['other'],
      fetcher,
    );

    await expect(source.fetchUpcomingEvents()).resolves.toEqual([]);
  });
});
