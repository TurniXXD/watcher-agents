import { XMLParser } from 'fast-xml-parser';
import type { RealityListing, RealityMetric } from './types.js';

export type RealityFeedResult = {
  metrics: RealityMetric[];
  listings: RealityListing[];
  /** Sources listed here returned their complete active inventory. */
  completeListingSources?: string[];
};

export type RealityProvider = {
  readonly id: string;
  fetch(signal?: AbortSignal): Promise<RealityFeedResult>;
};

type RssItem = {
  guid?: unknown;
  link?: unknown;
  title?: unknown;
  description?: unknown;
  pubDate?: unknown;
};

type ParsedRssListing = {
  externalId: string;
  url: string;
  title: string;
  description: string;
  priceCzk: number;
  floorAreaM2: number;
  disposition?: string;
  publishedAt?: Date;
};

const SOURCE = 'DigiReality.cz RSS';
const ORIGIN = 'https://www.digireality.cz';
const RESPONSE_LIMIT_BYTES = 8 * 1024 * 1024;
const DEFAULT_CACHE_MS = 55 * 60_000;

const asText = (value: unknown): string | undefined => {
  if (typeof value === 'string' || typeof value === 'number')
    return String(value).trim();
  if (value && typeof value === 'object' && '#text' in value) {
    const text = (value as { '#text'?: unknown })['#text'];
    if (typeof text === 'string' || typeof text === 'number')
      return String(text).trim();
  }
  return undefined;
};

const stripHtml = (value: string): string =>
  value
    .replace(/<br\s*\/?>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

const citySlug = (location: string): string =>
  location
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '');

const parsePrice = (description: string): number | undefined => {
  const captured = /Cena:\s*([^,]+)/iu.exec(description)?.[1];
  if (!captured || /neuvedena|dohodou|na dotaz/iu.test(captured))
    return undefined;
  const digits = captured.replace(/[^0-9]/gu, '');
  if (!digits) return undefined;
  const price = Number(digits);
  return Number.isSafeInteger(price) && price > 0 ? price : undefined;
};

const parseArea = (title: string, description: string): number | undefined => {
  const matches = `${title} ${description}`.matchAll(
    /(\d+(?:[.,]\d+)?)\s*m(?:²|2)(?=\s|[,.;)]|$)/giu,
  );
  for (const match of matches) {
    const area = Number(match[1]?.replace(',', '.'));
    if (Number.isFinite(area) && area >= 10 && area <= 500) return area;
  }
  return undefined;
};

const parseDisposition = (title: string): string | undefined => {
  const match = /\b([1-9]\s*\+\s*(?:kk|[0-9])|garsoni[eé]ra?|pokoj)\b/iu.exec(
    title,
  )?.[1];
  if (!match) return undefined;
  if (/^garson/iu.test(match)) return 'garsoniéra';
  return match.replace(/\s+/gu, '').toLowerCase();
};

const median = (values: readonly number[]): number | undefined => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
};

const monthStart = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

const sampleMedian = (
  listings: readonly ParsedRssListing[],
  disposition?: string,
): number | undefined =>
  median(
    listings
      .filter((listing) => !disposition || listing.disposition === disposition)
      .map((listing) => listing.priceCzk / listing.floorAreaM2)
      .filter((value) => Number.isFinite(value) && value > 0),
  );

/**
 * Reads DigiReality's public RSS channel. Its published terms allow personal,
 * non-commercial use. Only the newest page is requested for each city and
 * transaction type, keeping anonymous traffic below the documented limits.
 */
export class DigiRealityProvider implements RealityProvider {
  public readonly id: string;
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    trimValues: true,
  });
  private readonly rssUrls = new Map<'sale' | 'rent', string>();
  private cache?: { fetchedAt: number; result: RealityFeedResult };

  public constructor(
    private readonly location: string,
    private readonly apiKey?: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
    private readonly cacheMs = DEFAULT_CACHE_MS,
  ) {
    this.id = `digireality:${citySlug(location)}`;
  }

  private async getText(url: string, accept: string, signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(30_000);
    const response = await this.fetcher(url, {
      headers: {
        Accept: accept,
        'User-Agent': 'Watcher-RealityBot/1.0 (+private personal monitor)',
      },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok)
      throw new Error(`${url} returned HTTP ${response.status}`);
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > RESPONSE_LIMIT_BYTES)
      throw new Error(`${url} exceeded the 8 MiB response limit`);
    return body;
  }

  private searchUrl(kind: 'sale' | 'rent') {
    const transaction = kind === 'sale' ? 'prodej' : 'pronajem';
    return `${ORIGIN}/reality/${citySlug(this.location)}_${transaction}-bytu`;
  }

  private async discoverRssUrl(kind: 'sale' | 'rent', signal?: AbortSignal) {
    const cached = this.rssUrls.get(kind);
    if (cached) return cached;
    const searchUrl = this.searchUrl(kind);
    const html = await this.getText(searchUrl, 'text/html', signal);
    const encodedHref = /href="([^"\s]*\/Home\/Rss\?[^"\s]+)"/iu.exec(
      html,
    )?.[1];
    if (!encodedHref)
      throw new Error(
        `DigiReality did not expose an RSS link for ${searchUrl}`,
      );
    const url = new URL(encodedHref.replaceAll('&amp;', '&'), ORIGIN);
    if (url.origin !== ORIGIN)
      throw new Error(
        `DigiReality exposed an off-origin RSS link for ${searchUrl}`,
      );
    url.searchParams.set('page', '1');
    if (this.apiKey) url.searchParams.set('key', this.apiKey);
    const value = url.toString();
    this.rssUrls.set(kind, value);
    return value;
  }

  private parseRss(xml: string): ParsedRssListing[] {
    const parsed = this.parser.parse(xml.replace(/^\uFEFF/u, '')) as {
      rss?: { channel?: { item?: RssItem | RssItem[] } };
    };
    const rawItems = parsed.rss?.channel?.item;
    const items = rawItems
      ? Array.isArray(rawItems)
        ? rawItems
        : [rawItems]
      : [];
    return items.flatMap((item) => {
      const externalId = asText(item.guid);
      const url = asText(item.link);
      const title = asText(item.title);
      const rawDescription = asText(item.description);
      if (!externalId || !url || !title || !rawDescription) return [];
      const description = stripHtml(rawDescription);
      const priceCzk = parsePrice(description);
      const floorAreaM2 = parseArea(title, description);
      if (!priceCzk || !floorAreaM2) return [];
      const published = asText(item.pubDate);
      const publishedAt = published ? new Date(published) : undefined;
      const disposition = parseDisposition(title);
      return [
        {
          externalId,
          url,
          title,
          description,
          priceCzk,
          floorAreaM2,
          ...(disposition ? { disposition } : {}),
          ...(publishedAt && !Number.isNaN(publishedAt.getTime())
            ? { publishedAt }
            : {}),
        },
      ];
    });
  }

  private metric(
    metric: 'MEDIAN_ASK_PRICE_PER_M2' | 'RENT_PER_M2',
    value: number,
    period: Date,
    observedAt: Date,
    sourceUrl: string,
    sampleSize: number,
    disposition?: string,
  ): RealityMetric {
    return {
      externalId: [
        'digireality',
        metric.toLowerCase(),
        citySlug(this.location),
        disposition ?? 'all',
        period.toISOString().slice(0, 7),
      ].join('-'),
      source: SOURCE,
      category: metric === 'RENT_PER_M2' ? 'RENTS' : 'PRICES',
      metric,
      location: this.location,
      ...(disposition ? { disposition } : {}),
      value: Math.round(value),
      unit: 'CZK/m2',
      period,
      observedAt,
      sourceUrl,
      raw: { sampleSize, sample: 'latest RSS page' },
    };
  }

  public async fetch(signal?: AbortSignal): Promise<RealityFeedResult> {
    const observedAt = this.now();
    if (
      this.cache &&
      observedAt.getTime() - this.cache.fetchedAt < this.cacheMs
    )
      return this.cache.result;

    const [saleUrl, rentUrl] = await Promise.all([
      this.discoverRssUrl('sale', signal),
      this.discoverRssUrl('rent', signal),
    ]);
    const [saleXml, rentXml] = await Promise.all([
      this.getText(saleUrl, 'application/rss+xml, application/xml', signal),
      this.getText(rentUrl, 'application/rss+xml, application/xml', signal),
    ]);
    const sales = this.parseRss(saleXml);
    const rents = this.parseRss(rentXml);
    const period = monthStart(observedAt);
    const dispositions = new Set(
      [...sales, ...rents].flatMap((listing) =>
        listing.disposition ? [listing.disposition] : [],
      ),
    );
    const metrics: RealityMetric[] = [];
    for (const disposition of [undefined, ...dispositions]) {
      const saleMedian = sampleMedian(sales, disposition);
      const rentMedian = sampleMedian(rents, disposition);
      if (saleMedian !== undefined)
        metrics.push(
          this.metric(
            'MEDIAN_ASK_PRICE_PER_M2',
            saleMedian,
            period,
            observedAt,
            this.searchUrl('sale'),
            sales.filter(
              (listing) => !disposition || listing.disposition === disposition,
            ).length,
            disposition,
          ),
        );
      if (rentMedian !== undefined)
        metrics.push(
          this.metric(
            'RENT_PER_M2',
            rentMedian,
            period,
            observedAt,
            this.searchUrl('rent'),
            rents.filter(
              (listing) => !disposition || listing.disposition === disposition,
            ).length,
            disposition,
          ),
        );
    }

    const fallbackSaleMedian = sampleMedian(sales);
    const fallbackRentMedian = sampleMedian(rents);
    const listings: RealityListing[] = sales.flatMap((listing) => {
      const localMedianPricePerM2Czk =
        sampleMedian(sales, listing.disposition) ?? fallbackSaleMedian;
      const rentPerM2 =
        sampleMedian(rents, listing.disposition) ?? fallbackRentMedian;
      if (!localMedianPricePerM2Czk || !rentPerM2) return [];
      return [
        {
          externalId: listing.externalId,
          source: SOURCE,
          url: listing.url,
          title: listing.title,
          location: this.location,
          ...(listing.disposition ? { disposition: listing.disposition } : {}),
          priceCzk: listing.priceCzk,
          floorAreaM2: listing.floorAreaM2,
          estimatedMonthlyRentCzk: Math.round(rentPerM2 * listing.floorAreaM2),
          localMedianPricePerM2Czk: Math.round(localMedianPricePerM2Czk),
          ...(listing.publishedAt ? { publishedAt: listing.publishedAt } : {}),
          raw: {
            description: listing.description,
            rentEstimateSource: 'DigiReality latest RSS rent sample',
          },
        },
      ];
    });
    const result = { metrics, listings };
    this.cache = { fetchedAt: observedAt.getTime(), result };
    return result;
  }
}
