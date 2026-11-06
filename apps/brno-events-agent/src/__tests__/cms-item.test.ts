import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  cmsItemHash,
  factualSummary,
  toCmsEventItem,
  type CmsSourceEvent,
} from '../cms/event-item.js';

const event = (overrides: Partial<CmsSourceEvent> = {}): CmsSourceEvent => ({
  id: '0f8e2a52-7d2c-4c55-9e85-3b7f1f0a9c11',
  title: 'Python Workshop',
  description:
    'The organiser wrote a long, copyrighted description. Free pizza after the workshop!',
  startAt: new Date('2026-11-20T17:00:00.000Z'),
  endAt: new Date('2026-11-20T19:00:00.000Z'),
  venueName: 'Impact Hub',
  venueAddress: 'Cejl 1, Brno',
  city: 'Brno',
  organizerName: 'Brno Python',
  categories: ['programming', 'workshop'],
  priceAmount: 0,
  priceCurrency: null,
  priceFree: true,
  priceText: null,
  registrationRequired: true,
  registrationUrl: 'https://organiser.example.org/register',
  imageUrl: 'https://organiser.example.org/poster.jpg',
  cancelled: false,
  lastSeenAt: new Date('2026-11-06T08:00:00.000Z'),
  sourceLinks: [
    {
      sourceId: 'meetup',
      sourceName: 'Meetup',
      eventUrl: 'https://www.meetup.com/brno-python/events/1',
      firstSeenAt: new Date('2026-10-01T00:00:00Z'),
      lastSeenAt: new Date('2026-11-06T08:00:00Z'),
    },
  ],
  ...overrides,
});

describe('CMS event item mapping', () => {
  it('uses stable identifiers, an original summary, and source attribution', () => {
    const item = toCmsEventItem(event());
    expect(item).toMatchObject({
      externalId: 'brno-event:0f8e2a52-7d2c-4c55-9e85-3b7f1f0a9c11',
      summary:
        'Programming event in Brno at Impact Hub organised by Brno Python. Registration required.',
      sourceUrl: 'https://www.meetup.com/brno-python/events/1',
      category: 'programming',
      isFree: true,
      price: 0,
      currency: null,
      freeFood: 'yes',
      eventStatus: 'scheduled',
      sourceImageUrl: 'https://organiser.example.org/poster.jpg',
      sourceReferences: [
        {
          title: 'Meetup',
          url: 'https://www.meetup.com/brno-python/events/1',
          publisher: 'Meetup',
        },
      ],
    });
    expect(item.summary).not.toContain('copyrighted');
    expect(item).not.toHaveProperty('descriptionText');
    expect(item.sourceExcerpt?.length).toBeLessThanOrEqual(600);
  });

  it('marks cancellations and drops prices without a currency', () => {
    const item = toCmsEventItem(
      event({
        cancelled: true,
        priceAmount: 150,
        priceFree: false,
        priceCurrency: null,
      }),
    );
    expect(item).toMatchObject({
      eventStatus: 'cancelled',
      isFree: false,
      price: null,
      currency: null,
    });
    expect(
      toCmsEventItem(
        event({ priceAmount: 150, priceFree: false, priceCurrency: 'CZK' }),
      ),
    ).toMatchObject({ price: 150, currency: 'CZK' });
  });

  it('keeps the delivery hash stable within a day and sensitive to content', () => {
    const base = cmsItemHash(toCmsEventItem(event()));
    expect(
      cmsItemHash(
        toCmsEventItem(event({ lastSeenAt: new Date('2026-11-06T20:00:00Z') })),
      ),
    ).toBe(base);
    expect(
      cmsItemHash(
        toCmsEventItem(event({ lastSeenAt: new Date('2026-11-07T08:00:00Z') })),
      ),
    ).not.toBe(base);
    expect(
      cmsItemHash(
        toCmsEventItem(
          event({ startAt: new Date('2026-11-21T17:00:00Z'), endAt: null }),
        ),
      ),
    ).not.toBe(base);
  });

  it('falls back to a generic category summary', () => {
    expect(
      factualSummary(
        event({
          categories: ['other'],
          venueName: null,
          organizerName: null,
          registrationRequired: null,
        }),
      ),
    ).toBe('Other event in Brno.');
  });

  it('satisfies the published CMS ingestion contract', () => {
    const spec = JSON.parse(
      readFileSync(
        new URL('../../../content-cms/openapi/ingest.json', import.meta.url),
        'utf8',
      ),
    ) as {
      components: { schemas: Record<string, unknown> };
    };
    const rewrite = (value: unknown): unknown =>
      JSON.parse(
        JSON.stringify(value).replaceAll('#/components/schemas/', '#/$defs/'),
      );
    const contract = z.fromJSONSchema(
      rewrite({
        ...(spec.components.schemas.EventIngestItem as object),
        $defs: spec.components.schemas,
      }) as never,
    );
    expect(contract.safeParse({ externalId: 'x' }).success).toBe(false);
    for (const candidate of [
      event(),
      event({
        cancelled: true,
        description: null,
        imageUrl: null,
        endAt: null,
      }),
    ]) {
      const result = contract.safeParse(
        JSON.parse(JSON.stringify(toCmsEventItem(candidate))),
      );
      expect(result.error?.issues ?? []).toEqual([]);
    }
  });
});
