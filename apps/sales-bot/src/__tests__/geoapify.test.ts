import { describe, expect, it, vi } from 'vitest';
import {
  GeoapifyDiscoveryClient,
  resolveBusinessCategory,
} from '../geoapify.js';

describe('GeoapifyDiscoveryClient', () => {
  it('resolves known aliases and explicit provider categories', () => {
    expect(resolveBusinessCategory('autoservis')).toEqual({
      geoapifyCategory: 'service.vehicle.repair.car',
      naceCode: '95310',
    });
    expect(resolveBusinessCategory('nace:95310')).toEqual({
      geoapifyCategory: 'service.vehicle.repair.car',
      naceCode: '95310',
    });
    expect(resolveBusinessCategory('geo:service.beauty.hairdresser')).toEqual({
      geoapifyCategory: 'service.beauty.hairdresser',
    });
    expect(resolveBusinessCategory('horské chaty')).toEqual({
      geoapifyCategory: 'accommodation.hut,accommodation.chalet',
      naceCode: '55200',
    });
  });

  it('geocodes the locality, finds places, and enriches missing contacts', async () => {
    const requests: URL[] = [];
    const fetcher: typeof fetch = vi.fn(async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      if (url.pathname === '/v1/geocode/search') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              results: [{ place_id: 'brno-boundary', lat: 49.2, lon: 16.6 }],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      if (url.pathname === '/v2/places') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              features: [
                {
                  properties: {
                    place_id: 'geo-place-1',
                    name: 'Autoservis Test',
                    formatted: 'Brno, Česko',
                    lat: 49.21,
                    lon: 16.61,
                    datasource: {
                      raw: { osm_type: 'n', osm_id: 123 },
                    },
                  },
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            features: [
              {
                properties: {
                  feature_type: 'details',
                  website: 'https://autoservis.example',
                  contact: {
                    phone: '+420 123 456 789',
                    email: 'info@autoservis.example',
                  },
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    });

    const result = await new GeoapifyDiscoveryClient(
      'secret-key',
      fetcher,
      0,
    ).search('autoservis', 'Brno', 10);

    expect(result).toEqual([
      {
        id: 'geo-place-1',
        name: 'Autoservis Test',
        provider: 'GEOAPIFY',
        sourceUrl: 'https://www.openstreetmap.org/node/123',
        websiteUrl: 'https://autoservis.example/',
        address: 'Brno, Česko',
        phone: '+420 123 456 789',
        email: 'info@autoservis.example',
      },
    ]);
    expect(requests).toHaveLength(3);
    expect(requests[0]?.searchParams.get('apiKey')).toBe('secret-key');
    expect(requests[1]?.searchParams.get('categories')).toBe(
      'service.vehicle.repair.car',
    );
    expect(requests[1]?.searchParams.get('filter')).toBe('place:brno-boundary');
    expect(requests[2]?.searchParams.get('features')).toBe('details');
  });

  it('does not issue a broad query for an unsupported free-text category', async () => {
    const fetcher: typeof fetch = vi.fn();
    const result = await new GeoapifyDiscoveryClient('key', fetcher, 0).search(
      'velmi specifický neznámý obor',
      'Brno',
      10,
    );
    expect(result).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
