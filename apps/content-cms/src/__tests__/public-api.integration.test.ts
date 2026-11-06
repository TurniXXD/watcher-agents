import type { Payload } from 'payload';
import { beforeAll, describe, expect, it } from 'vitest';
import { publicEventSchema } from '../public-api/schemas';
import {
  endpointRequest,
  findEndpoint,
  getTestPayload,
} from './helpers/payload';

type Json = Record<string, unknown>;
const DAY = 86_400_000;

describe('public events API (PostgreSQL)', () => {
  let payload: Payload;
  const base = Date.UTC(new Date().getUTCFullYear() + 1, 2, 10, 17, 0, 0); // well in the future, March (CET)

  const get = async (
    path: string,
    query = '',
    routeParams: Record<string, string> = {},
    headers: Record<string, string> = {},
  ) => {
    const handler = await findEndpoint(path);
    const response = await handler(
      endpointRequest(payload, {
        url: `https://cms.example.test/api${path}${query}`,
        routeParams,
        headers,
      }),
    );
    return {
      status: response.status,
      headers: response.headers,
      body: (await response.json()) as Json,
    };
  };

  const seed = (index: number, overrides: Json = {}) =>
    payload.create({
      collection: 'events',
      data: {
        title: `Seed event ${index}`,
        slug: `seed-event-${index}`,
        startsAt: new Date(base + index * DAY).toISOString(),
        city: 'Brno',
        category: 'workshop',
        sourceUrl: `https://organiser.example.org/e/${index}`,
        freeFood: 'unknown',
        eventStatus: 'scheduled',
        reviewStatus: 'approved',
        _status: 'published',
        ...overrides,
      } as never,
      overrideAccess: true,
    });

  beforeAll(async () => {
    payload = await getTestPayload();
    await payload.delete({
      collection: 'events',
      where: { id: { exists: true } },
      overrideAccess: true,
    });
    for (let index = 0; index < 25; index++) {
      await seed(index, {
        ...(index % 5 === 0
          ? { freeFood: 'yes', foodDetails: 'Free lunch', isFree: true }
          : {}),
        ...(index % 3 === 0
          ? { category: 'ai', isFree: false, price: 200, currency: 'CZK' }
          : {}),
        ...(index === 7
          ? { title: 'Quantum biology lecture', featured: true }
          : {}),
      });
    }
    // Same start time as seed 2 to exercise the id tie-breaker.
    await seed(100, {
      slug: 'seed-tie',
      startsAt: new Date(base + 2 * DAY).toISOString(),
    });
    await seed(101, { slug: 'seed-prague', city: 'Praha' });
    await seed(102, {
      slug: 'seed-draft',
      reviewStatus: 'needs_review',
      _status: 'draft',
    });
    await seed(103, {
      slug: 'seed-past',
      startsAt: new Date(Date.now() - 10 * DAY).toISOString(),
    });
  }, 120_000);

  it('lists only published upcoming Brno events, nearest first, with a valid DTO', async () => {
    const response = await get('/public/v1/events', '?limit=100');
    expect(response.status).toBe(200);
    const data = response.body.data as Json[];
    expect(data).toHaveLength(26);
    const slugs = data.map((item) => item.slug);
    expect(slugs).not.toContain('seed-prague');
    expect(slugs).not.toContain('seed-draft');
    expect(slugs).not.toContain('seed-past');
    const starts = data.map((item) => Date.parse(String(item.startsAt)));
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    for (const item of data)
      expect(publicEventSchema.safeParse(item).success).toBe(true);
    expect(response.headers.get('cache-control')).toContain('s-maxage=300');
    expect(response.body.meta).toEqual({ limit: 100 });
  });

  it('paginates deterministically with cursors and no duplicates', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = `?limit=7${cursor ? `&cursor=${cursor}` : ''}`;
      const response = await get('/public/v1/events', query);
      expect(response.status).toBe(200);
      seen.push(
        ...(response.body.data as Json[]).map((item) => String(item.id)),
      );
      cursor = response.body.nextCursor as string | null;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(4);
    expect(new Set(seen).size).toBe(26);
    expect(
      (await get('/public/v1/events', '?cursor=bm90LWEtY3Vyc29y')).status,
    ).toBe(400);
  });

  it('applies freeFood, free, category, featured, search, and combined filters', async () => {
    const freeFood = (
      await get('/public/v1/events', '?freeFood=true&limit=100')
    ).body.data as Json[];
    expect(freeFood.length).toBe(5);
    expect(
      freeFood.every(
        (item) => item.freeFood === 'yes' && item.foodDetails === 'Free lunch',
      ),
    ).toBe(true);

    const combined = (
      await get(
        '/public/v1/events',
        '?freeFood=true&category=AI&free=false&limit=100',
      )
    ).body.data as Json[];
    expect(combined.map((item) => item.slug).sort()).toEqual([
      'seed-event-0',
      'seed-event-15',
    ]);

    const featured = (await get('/public/v1/events/featured')).body
      .data as Json[];
    expect(featured.map((item) => item.slug)).toEqual(['seed-event-7']);

    const search = (await get('/public/v1/events', '?q=quantum')).body
      .data as Json[];
    expect(search.map((item) => item.slug)).toEqual(['seed-event-7']);

    const all = (await get('/public/v1/events', '?city=all&limit=100')).body
      .data as Json[];
    expect(all.map((item) => item.slug)).toContain('seed-prague');
    const prague = (await get('/public/v1/events', '?city=praha')).body
      .data as Json[];
    expect(prague.map((item) => item.slug)).toEqual(['seed-prague']);
  });

  it('interprets date-only filters as Europe/Prague calendar days', async () => {
    // seed-event-3 starts at 17:00 UTC (18:00 CET) on base+3 days.
    const day = new Date(base + 3 * DAY).toISOString().slice(0, 10);
    const response = await get('/public/v1/events', `?from=${day}&to=${day}`);
    expect((response.body.data as Json[]).map((item) => item.slug)).toEqual([
      'seed-event-3',
    ]);
    expect((await get('/public/v1/events', '?from=2026-02-30')).status).toBe(
      400,
    );
    expect(
      (await get('/public/v1/events', `?from=${day}T10:00:00`)).status,
    ).toBe(400);
  });

  it('validates query parameters and exposes categories', async () => {
    expect((await get('/public/v1/events', '?limit=101')).status).toBe(400);
    expect((await get('/public/v1/events', '?unknown=1')).status).toBe(400);
    expect((await get('/public/v1/events', '?freeFood=maybe')).status).toBe(
      400,
    );
    const categories = await get('/public/v1/events/categories');
    expect(categories.body.data).toEqual([
      { slug: 'ai', label: 'Ai' },
      { slug: 'workshop', label: 'Workshop' },
    ]);
    expect(categories.headers.get('cache-control')).toContain('s-maxage=3600');
  });

  it('returns 404 for unpublished details and honours CORS allow-list', async () => {
    expect(
      (await get('/public/v1/events/:slug', '', { slug: 'seed-draft' })).status,
    ).toBe(404);
    const ok = await get(
      '/public/v1/events/:slug',
      '',
      { slug: 'seed-event-1' },
      { origin: 'https://site.example.test' },
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe(
      'https://site.example.test',
    );
    expect(ok.headers.get('cache-control')).toContain('s-maxage=900');
    const foreign = await get(
      '/public/v1/events/:slug',
      '',
      { slug: 'seed-event-1' },
      { origin: 'https://evil.example' },
    );
    expect(foreign.headers.get('access-control-allow-origin')).toBe('null');
  });
});
