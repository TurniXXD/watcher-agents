import { z } from 'zod';

const placesResponseSchema = z.object({
  places: z
    .array(
      z.object({
        id: z.string().min(1),
        displayName: z.object({ text: z.string().min(1) }),
        formattedAddress: z.string().optional(),
        businessStatus: z.string().optional(),
        websiteUri: z.url().optional(),
        googleMapsUri: z.url().optional(),
        nationalPhoneNumber: z.string().optional(),
      }),
    )
    .optional(),
});

const placesSearchSchema = z.object({
  query: z.string().trim().min(1).max(120),
  locality: z.string().trim().min(1).max(120),
  limit: z.number().int().min(1).max(20),
});

export type PlaceDiscoveryResult = {
  id: string;
  name: string;
  websiteUrl: string;
  sourceUrl: string;
  address?: string;
  phone?: string;
};

const isHttpUrl = (value: string | undefined): value is string => {
  if (!value) return false;
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
};

export class GooglePlacesDiscoveryClient {
  public constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  public async search(
    query: string,
    locality: string,
    requestedLimit: number,
  ): Promise<PlaceDiscoveryResult[]> {
    const input = placesSearchSchema.parse({
      query,
      locality,
      limit: requestedLimit,
    });
    const response = await this.fetcher(
      'https://places.googleapis.com/v1/places:searchText',
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-goog-api-key': this.apiKey,
          'x-goog-fieldmask':
            'places.id,places.displayName,places.formattedAddress,places.businessStatus,places.websiteUri,places.googleMapsUri,places.nationalPhoneNumber',
        },
        body: JSON.stringify({
          textQuery: `${input.query} ${input.locality}`,
          pageSize: input.limit,
          languageCode: 'cs',
          regionCode: 'CZ',
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok)
      throw new Error(`Google Places Text Search HTTP ${response.status}`);
    const data = placesResponseSchema.parse(await response.json());
    return (data.places ?? [])
      .filter(
        (place) =>
          isHttpUrl(place.websiteUri) &&
          place.businessStatus !== 'CLOSED_PERMANENTLY',
      )
      .slice(0, input.limit)
      .map((place) => ({
        id: place.id,
        name: place.displayName.text,
        websiteUrl: place.websiteUri!,
        sourceUrl:
          (isHttpUrl(place.googleMapsUri) ? place.googleMapsUri : undefined) ??
          `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(place.id)}`,
        ...(place.formattedAddress ? { address: place.formattedAddress } : {}),
        ...(place.nationalPhoneNumber
          ? { phone: place.nationalPhoneNumber }
          : {}),
      }));
  }
}
