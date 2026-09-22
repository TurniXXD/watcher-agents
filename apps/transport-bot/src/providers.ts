import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  Coordinate,
  Location,
  RouteResult,
  TransportRequest,
} from './types.js';
import { transportRequestSchema } from './types.js';

type Fetch = typeof fetch;

export type FuelPrice = {
  fuel: 'diesel';
  pricePerLiter: number;
  currency: 'CZK';
  source: string;
  updatedAt: Date;
  stale: boolean;
};

export type FuelPriceProvider = {
  getCurrentPrice(input: { country: 'CZ' }): Promise<FuelPrice>;
};

export type FuelPriceCache = {
  get(country: string, fuel: string): Promise<FuelPrice | undefined>;
  put(country: string, price: FuelPrice): Promise<void>;
};

const fetchOk = async (fetcher: Fetch, url: string): Promise<Response> => {
  const response = await fetcher(url, {
    headers: { 'User-Agent': 'Watcher transport-bot/1.0' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new Error(`Provider request failed: HTTP ${response.status}`);
  return response;
};

const cnbRate = (body: string): { rate: number; date: Date } => {
  const lines = body.trim().split(/\r?\n/);
  const header = lines[0] ?? '';
  const numericDate = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(header);
  const englishDate = /^(\d{2} [A-Z][a-z]{2} \d{4})/.exec(header);
  const row = lines.find((line) => line.split('|')[3] === 'EUR');
  if (!row || (!numericDate && !englishDate))
    throw new Error('CNB response did not contain an EUR rate');
  const [, , amountText, , rateText] = row.split('|');
  const amount = Number(amountText);
  const rate = Number(rateText);
  if (!Number.isFinite(amount) || !Number.isFinite(rate) || amount <= 0)
    throw new Error('CNB returned an invalid EUR rate');
  const date = numericDate
    ? new Date(
        `${numericDate[3]}-${numericDate[2]}-${numericDate[1]}T12:00:00Z`,
      )
    : new Date(`${englishDate![1]} 12:00:00 UTC`);
  if (Number.isNaN(date.getTime()))
    throw new Error('CNB returned an invalid date');
  return {
    rate: rate / amount,
    date,
  };
};

const findCzechDieselPrice = async (buffer: Buffer): Promise<number> => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('EU Oil Bulletin workbook has no worksheet');
  let dieselColumn = -1;
  sheet.getRow(1).eachCell((cell, column) => {
    const value = cell.value;
    if (typeof value === 'string' && /automotive gas oil|diesel/i.test(value))
      dieselColumn = column;
  });
  if (dieselColumn < 1)
    throw new Error('EU Oil Bulletin diesel column was not found');
  let value: number | undefined;
  sheet.eachRow((row) => {
    const country = row.getCell(1).value;
    if (typeof country !== 'string' || country.trim() !== 'Czechia') return;
    const raw = row.getCell(dieselColumn).value;
    if (typeof raw === 'number') value = raw;
  });
  if (!value || value <= 0)
    throw new Error('EU Oil Bulletin Czech diesel price was not found');
  return value / 1_000;
};

export class EuCzechDieselPriceProvider implements FuelPriceProvider {
  public constructor(
    private readonly fetcher: Fetch = fetch,
    private readonly bulletinUrl = 'https://energy.ec.europa.eu/document/download/264c2d0f-f161-4ea3-a777-78faae59bea0_en?filename=Weekly%20Oil%20Bulletin%20Weekly%20prices%20with%20Taxes.xlsx',
    private readonly cnbUrl = 'https://www.cnb.cz/en/financial_markets/foreign_exchange_market/exchange_rate_fixing/daily.txt',
  ) {}

  public async getCurrentPrice(input: { country: 'CZ' }): Promise<FuelPrice> {
    if (input.country !== 'CZ')
      throw new Error('Only Czech fuel prices are supported');
    const [bulletin, exchange] = await Promise.all([
      fetchOk(this.fetcher, this.bulletinUrl),
      fetchOk(this.fetcher, this.cnbUrl),
    ]);
    const [eurPerLiter, exchangeRate] = await Promise.all([
      findCzechDieselPrice(Buffer.from(await bulletin.arrayBuffer())),
      exchange.text().then(cnbRate),
    ]);
    return {
      fuel: 'diesel',
      pricePerLiter: Math.round(eurPerLiter * exchangeRate.rate * 100) / 100,
      currency: 'CZK',
      source: 'European Commission Weekly Oil Bulletin + Czech National Bank',
      updatedAt: exchangeRate.date,
      stale: false,
    };
  }
}

export class CachedFuelPriceProvider implements FuelPriceProvider {
  public constructor(
    private readonly live: FuelPriceProvider,
    private readonly cache: FuelPriceCache,
    private readonly maximumFreshAgeMs = 24 * 60 * 60_000,
  ) {}

  public async getCurrentPrice(input: { country: 'CZ' }): Promise<FuelPrice> {
    const cached = await this.cache.get(input.country, 'diesel');
    if (
      cached &&
      Date.now() - cached.updatedAt.getTime() <= this.maximumFreshAgeMs
    )
      return cached;
    try {
      const live = await this.live.getCurrentPrice(input);
      await this.cache.put(input.country, live);
      return live;
    } catch (error) {
      if (cached) return { ...cached, stale: true };
      throw error;
    }
  }
}

export type RoutingProvider = {
  route(points: readonly Coordinate[]): Promise<RouteResult>;
};

export type RouteCache = {
  get(key: string): Promise<RouteResult | undefined>;
  put(key: string, route: RouteResult, expiresAt: Date): Promise<void>;
};

export class CachedRoutingProvider implements RoutingProvider {
  public constructor(
    private readonly provider: RoutingProvider,
    private readonly cache: RouteCache,
    private readonly ttlMs = 7 * 24 * 60 * 60_000,
  ) {}

  public async route(points: readonly Coordinate[]): Promise<RouteResult> {
    const key = createHash('sha256')
      .update(
        points
          .map(
            ({ latitude, longitude }) =>
              `${latitude.toFixed(5)},${longitude.toFixed(5)}`,
          )
          .join(';'),
      )
      .digest('hex');
    const cached = await this.cache.get(key);
    if (cached) return cached;
    const route = await this.provider.route(points);
    await this.cache.put(key, route, new Date(Date.now() + this.ttlMs));
    return route;
  }
}

const osrmResponseSchema = z.object({
  code: z.literal('Ok'),
  routes: z
    .array(
      z.object({
        distance: z.number().nonnegative(),
        duration: z.number().nonnegative(),
        geometry: z.string().optional(),
      }),
    )
    .min(1),
});

export class OsrmRoutingProvider implements RoutingProvider {
  public constructor(
    private readonly endpoint: string,
    private readonly fetcher: Fetch = fetch,
  ) {}

  public async route(points: readonly Coordinate[]): Promise<RouteResult> {
    if (points.length < 2 || points.length > 10)
      throw new Error('A route needs 2–10 points');
    const coordinates = points
      .map(({ longitude, latitude }) => `${longitude},${latitude}`)
      .join(';');
    const url = new URL(`/route/v1/driving/${coordinates}`, this.endpoint);
    url.searchParams.set('overview', 'false');
    url.searchParams.set('steps', 'false');
    const parsed = osrmResponseSchema.parse(
      await (await fetchOk(this.fetcher, url.toString())).json(),
    );
    const route = parsed.routes[0]!;
    return {
      distanceKm: Math.round((route.distance / 1_000) * 100) / 100,
      durationMinutes: Math.round((route.duration / 60) * 10) / 10,
      ...(route.geometry ? { geometry: route.geometry } : {}),
      provider: 'OSRM',
    };
  }
}

export type GeocodingProvider = {
  geocode(query: string): Promise<Location>;
};

export type GeocodingCache = {
  get(query: string): Promise<Location | undefined>;
  put(query: string, location: Location, expiresAt: Date): Promise<void>;
};

export class CachedGeocodingProvider implements GeocodingProvider {
  public constructor(
    private readonly provider: GeocodingProvider,
    private readonly cache: GeocodingCache,
    private readonly ttlMs = 30 * 24 * 60 * 60_000,
  ) {}

  public async geocode(rawQuery: string): Promise<Location> {
    const query = rawQuery.trim().toLocaleLowerCase('cs');
    const cached = await this.cache.get(query);
    if (cached) return cached;
    const location = await this.provider.geocode(rawQuery);
    await this.cache.put(query, location, new Date(Date.now() + this.ttlMs));
    return location;
  }
}

const geocodingSchema = z.object({
  results: z
    .array(
      z.object({
        name: z.string(),
        country: z.string().optional(),
        latitude: z.number(),
        longitude: z.number(),
      }),
    )
    .optional(),
});

export class OpenMeteoGeocodingProvider implements GeocodingProvider {
  public constructor(private readonly fetcher: Fetch = fetch) {}

  public async geocode(rawQuery: string): Promise<Location> {
    const query = rawQuery.trim();
    if (query.length < 2 || query.length > 200)
      throw new Error('Enter a valid place name');
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.searchParams.set('name', query);
    url.searchParams.set('count', '1');
    url.searchParams.set('language', 'cs');
    url.searchParams.set('format', 'json');
    const parsed = geocodingSchema.parse(
      await (await fetchOk(this.fetcher, url.toString())).json(),
    );
    const result = parsed.results?.[0];
    if (!result) throw new Error(`Location “${query}” was not found`);
    return {
      address: result.country
        ? `${result.name}, ${result.country}`
        : result.name,
      latitude: result.latitude,
      longitude: result.longitude,
    };
  }
}

export type TransportRequestProvider = {
  readonly id: string;
  fetchRequests(): Promise<TransportRequest[]>;
};

const feedSchema = z.union([
  z.array(transportRequestSchema),
  z
    .object({ requests: z.array(transportRequestSchema) })
    .transform(({ requests }) => requests),
]);

export class JsonFeedTransportRequestProvider implements TransportRequestProvider {
  public readonly id = 'json-feed';

  public constructor(
    private readonly endpoint: string,
    private readonly bearerToken?: string,
    private readonly fetcher: Fetch = fetch,
  ) {}

  public async fetchRequests(): Promise<TransportRequest[]> {
    const response = await this.fetcher(this.endpoint, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Watcher transport-bot/1.0',
        ...(this.bearerToken
          ? { Authorization: `Bearer ${this.bearerToken}` }
          : {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new Error(`Transport feed failed: HTTP ${response.status}`);
    return feedSchema.parse(await response.json());
  }
}
