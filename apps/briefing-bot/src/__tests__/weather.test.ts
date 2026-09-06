import { describe, expect, it, vi } from 'vitest';
import {
  OpenMeteoGeocodingProvider,
  OpenMeteoWeatherProvider,
  renderSpokenWeather,
} from '../weather.js';

const jsonResponse = (value: unknown): Response =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('Open-Meteo adapters', () => {
  it('validates and normalizes geocoding results', async () => {
    const requested: URL[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      requested.push(
        input instanceof URL
          ? input
          : new URL(typeof input === 'string' ? input : input.url),
      );
      return jsonResponse({
        results: [
          {
            name: 'Brno',
            country_code: 'CZ',
            latitude: 49.1951,
            longitude: 16.6068,
            timezone: 'Europe/Prague',
          },
        ],
      });
    });
    const provider = new OpenMeteoGeocodingProvider(fetcher);

    await expect(provider.search('Brno, CZ')).resolves.toEqual([
      {
        city: 'Brno',
        country: 'CZ',
        latitude: 49.1951,
        longitude: 16.6068,
        timezone: 'Europe/Prague',
      },
    ]);
    expect(requested[0]?.searchParams.get('name')).toBe('Brno, CZ');
  });

  it('normalizes and caches one-day practical weather', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      void input;
      return jsonResponse({
        timezone: 'Europe/Prague',
        current: {
          time: '2026-09-06T07:00',
          temperature_2m: 12.2,
          apparent_temperature: 11.1,
          precipitation: 0,
          weather_code: 2,
          wind_speed_10m: 8,
        },
        hourly: {
          time: ['2026-09-06T07:00', '2026-09-06T16:00'],
          precipitation_probability: [10, 70],
        },
        daily: {
          temperature_2m_max: [20.2],
          temperature_2m_min: [8.4],
          precipitation_probability_max: [70],
          rain_sum: [2.1],
          snowfall_sum: [0],
          sunrise: ['2026-09-06T06:17'],
          sunset: ['2026-09-06T19:28'],
        },
      });
    });
    const provider = new OpenMeteoWeatherProvider(fetcher);
    const first = await provider.forecast(49.1951, 16.6068, 'Europe/Prague');
    const second = await provider.forecast(49.1951, 16.6068, 'Europe/Prague');

    expect(first).toMatchObject({
      temperatureCelsius: 12.2,
      highCelsius: 20.2,
      precipitationProbabilityPercent: 70,
      precipitationLikelyAt: '2026-09-06T16:00',
    });
    expect(second).toEqual(first);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(renderSpokenWeather(first, 'Brno')).toContain(
      'Precipitation becomes likely around 16:00.',
    );
  });

  it('rejects malformed provider responses', async () => {
    const fetcher: typeof fetch = async () => jsonResponse({ current: {} });
    const provider = new OpenMeteoWeatherProvider(fetcher);
    await expect(
      provider.forecast(49.2, 16.6, 'Europe/Prague'),
    ).rejects.toThrow();
  });
});
