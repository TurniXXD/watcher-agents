import { z } from 'zod';

export type GeocodedLocation = {
  city: string;
  country?: string;
  latitude: number;
  longitude: number;
  timezone: string;
};

export type WeatherContext = {
  observedAt: string;
  timezone: string;
  temperatureCelsius: number;
  apparentTemperatureCelsius: number;
  precipitationMillimeters: number;
  weatherCode: number;
  windSpeedKmh: number;
  highCelsius: number;
  lowCelsius: number;
  precipitationProbabilityPercent: number;
  rainMillimeters: number;
  snowfallCentimeters: number;
  sunrise: string;
  sunset: string;
  precipitationLikelyAt?: string;
};

export type WeatherProvider = {
  forecast(
    latitude: number,
    longitude: number,
    timezone: string,
    signal?: AbortSignal,
  ): Promise<WeatherContext>;
};

export type GeocodingProvider = {
  search(query: string, signal?: AbortSignal): Promise<GeocodedLocation[]>;
};

const geocodingResponseSchema = z.object({
  results: z
    .array(
      z.object({
        name: z.string().min(1),
        country_code: z.string().length(2).optional(),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        timezone: z.string().min(1),
      }),
    )
    .optional(),
});

const weatherResponseSchema = z.object({
  timezone: z.string().min(1),
  current: z.object({
    time: z.string().min(1),
    temperature_2m: z.number(),
    apparent_temperature: z.number(),
    precipitation: z.number().nonnegative(),
    weather_code: z.number().int().nonnegative(),
    wind_speed_10m: z.number().nonnegative(),
  }),
  hourly: z.object({
    time: z.array(z.string()),
    precipitation_probability: z.array(z.number().min(0).max(100)),
  }),
  daily: z.object({
    temperature_2m_max: z.array(z.number()).min(1),
    temperature_2m_min: z.array(z.number()).min(1),
    precipitation_probability_max: z.array(z.number().min(0).max(100)).min(1),
    rain_sum: z.array(z.number().nonnegative()).min(1),
    snowfall_sum: z.array(z.number().nonnegative()).min(1),
    sunrise: z.array(z.string().min(1)).min(1),
    sunset: z.array(z.string().min(1)).min(1),
  }),
});

type Fetch = typeof fetch;

const responseJson = async (response: Response): Promise<unknown> => {
  if (!response.ok) {
    throw new Error(`Open-Meteo request failed: HTTP ${response.status}`);
  }
  return response.json() as Promise<unknown>;
};

export class OpenMeteoGeocodingProvider implements GeocodingProvider {
  public constructor(
    private readonly fetcher: Fetch = fetch,
    private readonly endpoint = 'https://geocoding-api.open-meteo.com/v1/search',
  ) {}

  public async search(
    rawQuery: string,
    signal?: AbortSignal,
  ): Promise<GeocodedLocation[]> {
    const query = rawQuery.trim();
    if (query.length < 2 || query.length > 200) {
      throw new Error('Location query must contain 2–200 characters');
    }
    const url = new URL(this.endpoint);
    url.searchParams.set('name', query);
    url.searchParams.set('count', '5');
    url.searchParams.set('language', 'en');
    url.searchParams.set('format', 'json');
    const parsed = geocodingResponseSchema.parse(
      await responseJson(
        await this.fetcher(url, signal ? { signal } : undefined),
      ),
    );
    return (parsed.results ?? []).map((location) => ({
      city: location.name,
      ...(location.country_code ? { country: location.country_code } : {}),
      latitude: location.latitude,
      longitude: location.longitude,
      timezone: location.timezone,
    }));
  }
}

type CachedForecast = { expiresAt: number; weather: WeatherContext };

export class OpenMeteoWeatherProvider implements WeatherProvider {
  private readonly cache = new Map<string, CachedForecast>();

  public constructor(
    private readonly fetcher: Fetch = fetch,
    private readonly endpoint = 'https://api.open-meteo.com/v1/forecast',
    private readonly cacheMilliseconds = 15 * 60_000,
  ) {}

  public async forecast(
    latitude: number,
    longitude: number,
    timezone: string,
    signal?: AbortSignal,
  ): Promise<WeatherContext> {
    const key = `${latitude.toFixed(3)}:${longitude.toFixed(3)}:${timezone}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.weather;

    const url = new URL(this.endpoint);
    url.searchParams.set('latitude', String(latitude));
    url.searchParams.set('longitude', String(longitude));
    url.searchParams.set('timezone', timezone);
    url.searchParams.set('forecast_days', '1');
    url.searchParams.set(
      'current',
      'temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m',
    );
    url.searchParams.set('hourly', 'precipitation_probability');
    url.searchParams.set(
      'daily',
      'temperature_2m_max,temperature_2m_min,precipitation_probability_max,rain_sum,snowfall_sum,sunrise,sunset',
    );
    const parsed = weatherResponseSchema.parse(
      await responseJson(
        await this.fetcher(url, signal ? { signal } : undefined),
      ),
    );
    const likelyIndex = parsed.hourly.precipitation_probability.findIndex(
      (probability, index) =>
        probability >= 50 &&
        (parsed.hourly.time[index] ?? '') >= parsed.current.time,
    );
    const weather: WeatherContext = {
      observedAt: parsed.current.time,
      timezone: parsed.timezone,
      temperatureCelsius: parsed.current.temperature_2m,
      apparentTemperatureCelsius: parsed.current.apparent_temperature,
      precipitationMillimeters: parsed.current.precipitation,
      weatherCode: parsed.current.weather_code,
      windSpeedKmh: parsed.current.wind_speed_10m,
      highCelsius: parsed.daily.temperature_2m_max[0]!,
      lowCelsius: parsed.daily.temperature_2m_min[0]!,
      precipitationProbabilityPercent:
        parsed.daily.precipitation_probability_max[0]!,
      rainMillimeters: parsed.daily.rain_sum[0]!,
      snowfallCentimeters: parsed.daily.snowfall_sum[0]!,
      sunrise: parsed.daily.sunrise[0]!,
      sunset: parsed.daily.sunset[0]!,
      ...(likelyIndex === -1
        ? {}
        : { precipitationLikelyAt: parsed.hourly.time[likelyIndex] }),
    };
    this.cache.set(key, {
      expiresAt: Date.now() + this.cacheMilliseconds,
      weather,
    });
    return weather;
  }
}

const weatherDescription = (code: number): string => {
  if (code === 0) return 'clear';
  if (code <= 3) return 'partly cloudy';
  if (code === 45 || code === 48) return 'foggy';
  if (code >= 71 && code <= 77) return 'snowy';
  if (code >= 95) return 'stormy';
  if (code >= 51 && code <= 67) return 'rainy';
  if (code >= 80 && code <= 82) return 'showery';
  return 'mixed';
};

const localHour = (value: string): string => {
  const time = value.split('T')[1]?.slice(0, 5);
  return time ?? value;
};

export const renderSpokenWeather = (
  weather: WeatherContext,
  place?: string,
): string => {
  const where = place ? ` in ${place}` : '';
  const precipitation = weather.precipitationLikelyAt
    ? ` Precipitation becomes likely around ${localHour(weather.precipitationLikelyAt)}.`
    : weather.precipitationProbabilityPercent >= 40
      ? ` There is a ${Math.round(weather.precipitationProbabilityPercent)} percent chance of precipitation.`
      : '';
  return `It is ${Math.round(weather.temperatureCelsius)} degrees${where} and ${weatherDescription(weather.weatherCode)}. Today's high is about ${Math.round(weather.highCelsius)}, with a low near ${Math.round(weather.lowCelsius)}.${precipitation}`;
};
