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
          time: ['2026-09-06'],
          weather_code: [2],
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
      forecastFor: 'today',
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

  it("loads and renders tomorrow's daily forecast for an evening briefing", async () => {
    const requested: URL[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      requested.push(
        input instanceof URL
          ? input
          : new URL(typeof input === 'string' ? input : input.url),
      );
      return jsonResponse({
        timezone: 'Europe/Prague',
        current: {
          time: '2026-09-06T20:00',
          temperature_2m: 15,
          apparent_temperature: 14,
          precipitation: 0,
          weather_code: 0,
          wind_speed_10m: 5,
        },
        hourly: {
          time: ['2026-09-07T08:00', '2026-09-07T15:00'],
          precipitation_probability: [20, 60],
        },
        daily: {
          time: ['2026-09-07'],
          weather_code: [61],
          temperature_2m_max: [18],
          temperature_2m_min: [9],
          precipitation_probability_max: [60],
          rain_sum: [2],
          snowfall_sum: [0],
          sunrise: ['2026-09-07T06:20'],
          sunset: ['2026-09-07T19:25'],
        },
      });
    });
    const provider = new OpenMeteoWeatherProvider(fetcher);

    const result = await provider.forecast(
      49.1951,
      16.6068,
      'Europe/Prague',
      undefined,
      { date: '2026-09-07', label: 'tomorrow' },
    );

    expect(requested[0]?.searchParams.get('start_date')).toBe('2026-09-07');
    expect(requested[0]?.searchParams.get('end_date')).toBe('2026-09-07');
    expect(requested[0]?.searchParams.has('forecast_days')).toBe(false);
    expect(result).toMatchObject({
      forecastFor: 'tomorrow',
      observedAt: '2026-09-07',
      weatherCode: 61,
      highCelsius: 18,
      lowCelsius: 9,
      precipitationLikelyAt: '2026-09-07T15:00',
    });
    const spoken = renderSpokenWeather(result, 'Brno');
    expect(spoken).toContain('Tomorrow in Brno will be rainy.');
    expect(spoken).toContain('The high will be about 18 degrees');
    expect(spoken).not.toContain("Today's high");
    expect(spoken).not.toContain('It is 15 degrees');
  });

  it('rejects malformed provider responses', async () => {
    const fetcher: typeof fetch = async () => jsonResponse({ current: {} });
    const provider = new OpenMeteoWeatherProvider(fetcher);
    await expect(
      provider.forecast(49.2, 16.6, 'Europe/Prague'),
    ).rejects.toThrow();
  });
});
