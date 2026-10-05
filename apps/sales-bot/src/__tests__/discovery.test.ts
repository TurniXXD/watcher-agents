import { describe, expect, it } from 'vitest';
import { GooglePlacesDiscoveryClient } from '../discovery.js';

describe('GooglePlacesDiscoveryClient', () => {
  it('imports only open candidates with a website and keeps source provenance', async () => {
    const requests: Array<[URL | RequestInfo, RequestInit | undefined]> = [];
    const fetcher: typeof fetch = async (input, options) => {
      requests.push([input, options]);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            places: [
              {
                id: 'place-1',
                displayName: { text: 'Autoservis Test' },
                formattedAddress: 'Brno',
                businessStatus: 'OPERATIONAL',
                websiteUri: 'https://autoservis.example',
                googleMapsUri: 'https://maps.google.com/example',
              },
              {
                id: 'place-2',
                displayName: { text: 'No website' },
                businessStatus: 'OPERATIONAL',
              },
              {
                id: 'place-3',
                displayName: { text: 'Closed' },
                businessStatus: 'CLOSED_PERMANENTLY',
                websiteUri: 'https://closed.example',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    };
    const result = await new GooglePlacesDiscoveryClient(
      'secret-key',
      fetcher,
    ).search('autoservis', 'Brno', 20);

    expect(result).toEqual([
      {
        id: 'place-1',
        name: 'Autoservis Test',
        provider: 'GOOGLE_PLACES',
        websiteUrl: 'https://autoservis.example',
        sourceUrl: 'https://maps.google.com/example',
        address: 'Brno',
      },
    ]);
    expect(requests).toHaveLength(1);
    const [, options] = requests[0]!;
    if (typeof options?.body !== 'string')
      throw new Error('Expected a JSON request body');
    expect(JSON.parse(options.body)).toMatchObject({
      textQuery: 'autoservis Brno',
      pageSize: 20,
      languageCode: 'cs',
      regionCode: 'CZ',
    });
    expect(options?.headers).toMatchObject({
      'x-goog-api-key': 'secret-key',
    });
  });

  it('fails explicitly when the provider rejects the request', async () => {
    const fetcher: typeof fetch = async () =>
      Promise.resolve(new Response('', { status: 403 }));
    await expect(
      new GooglePlacesDiscoveryClient('bad-key', fetcher).search(
        'autoservis',
        'Brno',
        10,
      ),
    ).rejects.toThrow('HTTP 403');
  });

  it('returns phone-only candidates for a one-off directory search', async () => {
    const fetcher: typeof fetch = async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            places: [
              {
                id: 'place-phone',
                displayName: { text: 'Telefonní kontakt' },
                businessStatus: 'OPERATIONAL',
                nationalPhoneNumber: '+420 123 456 789',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

    const result = await new GooglePlacesDiscoveryClient(
      'key',
      fetcher,
    ).searchDirectory('autoservis', 'Brno', 10);

    expect(result).toEqual([
      {
        id: 'place-phone',
        name: 'Telefonní kontakt',
        provider: 'GOOGLE_PLACES',
        phone: '+420 123 456 789',
        sourceUrl:
          'https://www.google.com/maps/search/?api=1&query_place_id=place-phone',
      },
    ]);
  });

  it('rejects an out-of-range result limit before calling the provider', async () => {
    const fetcher: typeof fetch = async () =>
      Promise.resolve(new Response('{}', { status: 200 }));
    await expect(
      new GooglePlacesDiscoveryClient('key', fetcher).search(
        'autoservis',
        'Brno',
        21,
      ),
    ).rejects.toThrow();
  });
});
