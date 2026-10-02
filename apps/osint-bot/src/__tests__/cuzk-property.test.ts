import { describe, expect, it, vi } from 'vitest';
import {
  createCuzkAddressPlaceCollector,
  createCuzkBuildingCollector,
  createCuzkCadastralAreaCollector,
  createCuzkParcelCollector,
} from '../collectors/cuzk-property.js';

const xmlResponse = (xml: string) =>
  new Response(xml, {
    status: 200,
    headers: { 'content-type': 'application/gml+xml' },
  });

describe('ČÚZK property collectors', () => {
  it('resolves an address place to official building and parcel identifiers', async () => {
    const fetcher = vi.fn(async () =>
      xmlResponse(`<?xml version="1.0"?>
        <ad:Address xmlns:ad="urn:ad" xmlns:gml="urn:gml" xmlns:base="urn:base" xmlns:xlink="urn:xlink" gml:id="AD.21720461">
          <ad:inspireId><base:Identifier><base:localId>AD.21720461</base:localId></base:Identifier></ad:inspireId>
          <ad:alternativeIdentifier>Kožná 481/11, Staré Město, 11000 Praha 1</ad:alternativeIdentifier>
          <ad:validFrom>2023-12-18T09:07:12Z</ad:validFrom>
          <ad:parcel xlink:href="https://example.invalid/?Id=CP.2099301101" xlink:title="CP.2099301101" />
          <ad:building xlink:href="https://example.invalid/?Id=BU.29402461" xlink:title="BU.29402461" />
        </ad:Address>`),
    ) as unknown as typeof fetch;

    const docs = await createCuzkAddressPlaceCollector(fetcher).collect(
      {
        type: 'ADDRESS_PLACE',
        value: 'AD.21720461',
        original: 'AD.21720461',
        depth: 0,
      },
      new AbortController().signal,
    );

    expect(docs[0]?.data).toMatchObject({
      inspireId: 'AD.21720461',
      buildingId: 'BU.29402461',
      cadastralParcelId: 'CP.2099301101',
    });
    expect(docs[0]?.links.map((link) => link.type)).toEqual([
      'ADDRESS_OF_BUILDING',
      'ADDRESS_LOCATED_ON_PARCEL',
    ]);
    expect(docs[0]?.discoveredSelectors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'CADASTRAL_PARCEL',
          value: 'CP.2099301101',
        }),
      ]),
    );
    expect(docs[0]?.discoveredSelectors).toHaveLength(1);
  });

  it('collects a parcel and discovers its cadastral area without owner data', async () => {
    const fetcher = vi.fn(async () =>
      xmlResponse(`<?xml version="1.0"?>
        <cp:CadastralParcel xmlns:cp="urn:cp" xmlns:gml="urn:gml" xmlns:base="urn:base" xmlns:xlink="urn:xlink" gml:id="CP.2131099101">
          <cp:areaValue uom="m2">3128</cp:areaValue>
          <cp:beginLifespanVersion>2022-09-29T00:36:32Z</cp:beginLifespanVersion>
          <cp:inspireId><base:Identifier><base:localId>CP.2131099101</base:localId></base:Identifier></cp:inspireId>
          <cp:label>188</cp:label>
          <cp:nationalCadastralReference>730190-188</cp:nationalCadastralReference>
          <cp:zoning xlink:href="https://example.invalid/?Id=CZ.730190" xlink:title="Troja" />
        </cp:CadastralParcel>`),
    ) as unknown as typeof fetch;

    const docs = await createCuzkParcelCollector(fetcher).collect(
      {
        type: 'CADASTRAL_PARCEL',
        value: 'CP.2131099101',
        original: 'parcela: CP.2131099101',
        depth: 0,
      },
      new AbortController().signal,
    );

    expect(docs[0]?.data).toMatchObject({
      inspireId: 'CP.2131099101',
      areaSquareMetres: 3128,
      cadastralArea: 'Troja',
    });
    expect(docs[0]?.links[0]?.type).toBe('LOCATED_IN_CADASTRAL_AREA');
    expect(docs[0]?.discoveredSelectors).toEqual([
      expect.objectContaining({ type: 'CADASTRAL_AREA', value: 'CZ.730190' }),
    ]);
    expect(JSON.stringify(docs)).not.toMatch(/owner|vlastník/iu);
  });

  it('queries a parcel by cadastral code and parcel number', async () => {
    let requestedUrl = '';
    const request = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      return xmlResponse(`<?xml version="1.0"?>
        <FeatureCollection xmlns="urn:wfs" numberMatched="0" />`);
    });
    const fetcher = request as unknown as typeof fetch;

    await createCuzkParcelCollector(fetcher).collect(
      {
        type: 'CADASTRAL_PARCEL',
        value: '730190|188',
        original: 'parcela: 730190 188',
        depth: 0,
      },
      new AbortController().signal,
    );

    const url = new URL(requestedUrl);
    expect(url.searchParams.get('storedQuery_id')).toBe('GetParcel');
    expect(url.searchParams.get('UPPER_ZONING_ID')).toBe('730190');
    expect(url.searchParams.get('TEXT')).toBe('188');
  });

  it('collects a building, public register references, and its parcel link', async () => {
    let requestedUrlValue = '';
    const request = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrlValue =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      return xmlResponse(`<?xml version="1.0"?>
        <bu-ext2d:Building xmlns:bu-ext2d="urn:bu2d" xmlns:bu-base="urn:bub" xmlns:bu-ext="urn:bue" xmlns:base="urn:base" xmlns:gn="urn:gn" xmlns:gml="urn:gml" xmlns:xlink="urn:xlink" gml:id="BU.2267001">
          <bu-base:beginLifespanVersion>2024-10-19T19:17:37Z</bu-base:beginLifespanVersion>
          <bu-base:conditionOfConstruction xlink:title="functional" />
          <bu-base:externalReference><bu-base:ExternalReference><bu-base:informationSystem>http://vdp.cuzk.cz/</bu-base:informationSystem><bu-base:reference>21645736</bu-base:reference></bu-base:ExternalReference></bu-base:externalReference>
          <bu-base:externalReference><bu-base:ExternalReference><bu-base:informationSystem>http://nahlizenidokn.cuzk.cz/</bu-base:informationSystem><bu-base:reference>896164101</bu-base:reference></bu-base:ExternalReference></bu-base:externalReference>
          <bu-base:inspireId><base:Identifier><base:localId>BU.2267001</base:localId></base:Identifier></bu-base:inspireId>
          <bu-base:name><gn:GeographicalName><gn:spelling><gn:SpellingOfName><gn:text>č.p. 481</gn:text></gn:SpellingOfName></gn:spelling></gn:GeographicalName></bu-base:name>
          <bu-base:numberOfBuildingUnits>1</bu-base:numberOfBuildingUnits>
          <bu-ext2d:buildingInfo><bu-ext:officialArea><bu-ext:OfficialArea><bu-ext:value uom="m2">694</bu-ext:value></bu-ext:OfficialArea></bu-ext:officialArea><bu-ext:cadastralParcel xlink:href="https://example.invalid/?Id=CP.2099301101" /></bu-ext2d:buildingInfo>
        </bu-ext2d:Building>`);
    });
    const fetcher = request as unknown as typeof fetch;

    const docs = await createCuzkBuildingCollector(fetcher).collect(
      {
        type: 'BUILDING',
        value: 'SO.21645736',
        original: 'budova: 21645736',
        depth: 1,
      },
      new AbortController().signal,
    );

    expect(docs[0]?.data).toMatchObject({
      name: 'č.p. 481',
      officialAreaSquareMetres: 694,
      cadastralParcelId: 'CP.2099301101',
      isknReference: '896164101',
      isuiReference: '21645736',
      ruianBuildingCode: '21645736',
    });
    expect(docs[0]?.links.map((link) => link.type)).toEqual([
      'RESOLVES_TO_INSPIRE_BUILDING',
      'LOCATED_ON_PARCEL',
    ]);
    expect(docs[0]?.discoveredSelectors).toEqual([
      expect.objectContaining({
        type: 'CADASTRAL_PARCEL',
        value: 'CP.2099301101',
        depth: 2,
      }),
    ]);
    const requestedUrl = new URL(requestedUrlValue);
    expect(requestedUrl.searchParams.get('storedQuery_id')).toBe(
      'GetBuildingByFacilityCode',
    );
    expect(requestedUrl.searchParams.get('SO_CODE')).toBe('21645736');
  });

  it('collects an exact cadastral area by public name', async () => {
    let requestedUrl = '';
    const request = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      return xmlResponse(`<?xml version="1.0"?>
        <FeatureCollection xmlns="urn:wfs" xmlns:cp="urn:cp" xmlns:gml="urn:gml" xmlns:base="urn:base">
          <member><cp:CadastralZoning gml:id="CZ.753386"><cp:inspireId><base:Identifier><base:localId>CZ.753386</base:localId></base:Identifier></cp:inspireId><cp:label>Stachy</cp:label><cp:nationalCadastalZoningReference>753386</cp:nationalCadastalZoningReference><cp:originalMapScaleDenominator>1000</cp:originalMapScaleDenominator></cp:CadastralZoning></member>
        </FeatureCollection>`);
    });
    const fetcher = request as unknown as typeof fetch;

    const docs = await createCuzkCadastralAreaCollector(fetcher).collect(
      {
        type: 'CADASTRAL_AREA',
        value: 'Stachy',
        original: 'katastr: Stachy',
        depth: 0,
      },
      new AbortController().signal,
    );

    expect(docs[0]?.data).toMatchObject({
      inspireId: 'CZ.753386',
      name: 'Stachy',
      nationalReference: '753386',
      originalMapScaleDenominator: 1000,
    });
    const url = new URL(requestedUrl);
    expect(url.searchParams.get('storedQuery_id')).toBe('GetZoningByName');
    expect(url.searchParams.get('ZONING_NAME')).toBe('Stachy');
  });

  it('rejects oversized and malformed XML responses', async () => {
    const oversized = vi.fn(
      async () =>
        new Response('x', {
          headers: { 'content-length': '2000001' },
        }),
    ) as unknown as typeof fetch;
    await expect(
      createCuzkBuildingCollector(oversized).collect(
        {
          type: 'BUILDING',
          value: 'BU.1',
          original: 'BU.1',
          depth: 0,
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/size limit/);

    const malformed = vi.fn(async () =>
      xmlResponse('<broken>'),
    ) as unknown as typeof fetch;
    await expect(
      createCuzkBuildingCollector(malformed).collect(
        {
          type: 'BUILDING',
          value: 'BU.1',
          original: 'BU.1',
          depth: 0,
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/malformed XML/);
  });
});
