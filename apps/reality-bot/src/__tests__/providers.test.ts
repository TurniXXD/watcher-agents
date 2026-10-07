import { describe, expect, it } from 'vitest';
import { DigiRealityProvider } from '../providers.js';

const requestUrl = (input: RequestInfo | URL): string =>
  typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

const rss = (item: string) => `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel>${item}</channel></rss>`;

const item = (input: {
  id: string;
  title: string;
  price: string;
  description?: string;
}) => `<item>
  <guid isPermaLink="false">${input.id}</guid>
  <link>https://www.digireality.cz/inzerat/${input.id}</link>
  <title>${input.title}</title>
  <description>Cena: ${input.price}, ${input.description ?? 'Aktuální nabídka.'}</description>
  <pubDate>Mon, 05 Oct 2026 10:00:00 Z</pubDate>
</item>`;

describe('DigiRealityProvider', () => {
  it('discovers city RSS feeds and derives listings, rent and price medians', async () => {
    const requested: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = requestUrl(input);
      requested.push(url);
      if (url.includes('_prodej-bytu'))
        return new Response(
          '<a href="/Home/Rss?offerTypes=FlatSell&amp;borders=x">RSS</a>',
        );
      if (url.includes('_pronajem-bytu'))
        return new Response(
          '<a href="/Home/Rss?offerTypes=FlatRent&amp;borders=x">RSS</a>',
        );
      if (url.includes('FlatSell'))
        return new Response(
          rss(
            item({
              id: 'sale-1',
              title: 'Prodej bytu 2+kk, 50 m2, Brno',
              price: '5 000 000 Kč',
            }),
          ),
        );
      if (url.includes('FlatRent'))
        return new Response(
          rss(
            item({
              id: 'rent-1',
              title: 'Pronájem bytu 2+kk, 50 m², Brno',
              price: '20 000 Kč/měsíc',
            }),
          ),
        );
      return new Response('not found', { status: 404 });
    };
    const provider = new DigiRealityProvider(
      'Brno',
      'pilot-key',
      fetcher,
      () => new Date('2026-10-05T12:00:00Z'),
    );

    const result = await provider.fetch();
    const cached = await provider.fetch();

    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]).toMatchObject({
      source: 'DigiReality.cz RSS',
      location: 'Brno',
      disposition: '2+kk',
      priceCzk: 5_000_000,
      floorAreaM2: 50,
      estimatedMonthlyRentCzk: 20_000,
      localMedianPricePerM2Czk: 100_000,
    });
    expect(
      result.metrics.find((metric) => metric.metric === 'RENT_PER_M2'),
    ).toMatchObject({ value: 400, location: 'Brno' });
    expect(
      result.metrics.find(
        (metric) => metric.metric === 'MEDIAN_ASK_PRICE_PER_M2',
      ),
    ).toMatchObject({ value: 100_000, location: 'Brno' });
    expect(requested.filter((url) => url.includes('/Home/Rss'))).toHaveLength(
      2,
    );
    expect(
      requested.every(
        (url) => !url.includes('/Home/Rss') || url.includes('key=pilot-key'),
      ),
    ).toBe(true);
    expect(cached).toBe(result);
  });

  it('skips offers without a numeric price instead of inventing one', async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = requestUrl(input);
      if (url.includes('_prodej-bytu'))
        return new Response('<a href="/Home/Rss?offerTypes=FlatSell">RSS</a>');
      if (url.includes('_pronajem-bytu'))
        return new Response('<a href="/Home/Rss?offerTypes=FlatRent">RSS</a>');
      return new Response(
        rss(
          item({
            id: 'hidden-price',
            title: 'Byt 1+kk, 30 m2',
            price: 'Cena neuvedena',
          }),
        ),
      );
    };
    const provider = new DigiRealityProvider('Ostrava', undefined, fetcher);

    const result = await provider.fetch();

    expect(result.listings).toEqual([]);
    expect(result.metrics).toEqual([]);
  });

  it('never sends the optional key to an off-origin discovered feed', async () => {
    const requested: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      requested.push(requestUrl(input));
      return new Response(
        '<a href="https://attacker.invalid/Home/Rss?offerTypes=FlatSell">RSS</a>',
      );
    };
    const provider = new DigiRealityProvider('Brno', 'secret-key', fetcher);

    await expect(provider.fetch()).rejects.toThrow('off-origin RSS link');
    expect(requested).toEqual([
      'https://www.digireality.cz/reality/brno_prodej-bytu',
      'https://www.digireality.cz/reality/brno_pronajem-bytu',
    ]);
    expect(requested.join(' ')).not.toContain('secret-key');
  });
});
