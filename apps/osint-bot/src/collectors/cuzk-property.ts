import { sourceHttpError } from '@watcher/core';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { Selector } from '../selectors.js';
import type { Collector, EntityRef, EvidenceDocument } from './types.js';

const parcelEndpoint = 'https://services.cuzk.gov.cz/wfs/inspire-cp-wfs.asp';
const buildingEndpoint = 'https://services.cuzk.gov.cz/wfs/inspire-bu-wfs.asp';
const addressEndpoint = 'https://services.cuzk.gov.cz/wfs/inspire-ad-wfs.asp';
const maxResponseBytes = 2_000_000;

type XmlObject = Record<string, unknown>;

const isObject = (value: unknown): value is XmlObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asText = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (isObject(value)) return asText(value['#text']);
  return undefined;
};

const namedObjects = (root: unknown, name: string): XmlObject[] => {
  const matches: XmlObject[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isObject(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (key === name) {
        for (const item of Array.isArray(child) ? child : [child])
          if (isObject(item)) matches.push(item);
      }
      visit(child);
    }
  };
  visit(root);
  return matches;
};

const firstNamedText = (root: unknown, name: string): string | undefined => {
  let result: string | undefined;
  const visit = (value: unknown): void => {
    if (result !== undefined) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isObject(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (key === name) {
        result = asText(child);
        if (result !== undefined) return;
      }
      visit(child);
    }
  };
  visit(root);
  return result;
};

const attribute = (node: XmlObject, name: string): string | undefined =>
  asText(node[`@_${name}`]);

const referenceId = (node: XmlObject, prefix: 'BU' | 'CP' | 'CZ') => {
  const source = `${attribute(node, 'href') ?? ''} ${attribute(node, 'title') ?? ''}`;
  return source.match(new RegExp(`\\b${prefix}\\.\\d+`, 'u'))?.[0];
};

const buildWfsUrl = (
  endpoint: string,
  parameters: Record<string, string>,
): string => {
  const url = new URL(endpoint);
  url.searchParams.set('service', 'WFS');
  url.searchParams.set('version', '2.0.0');
  url.searchParams.set('request', 'GetFeature');
  for (const [key, value] of Object.entries(parameters))
    url.searchParams.set(key, value);
  return url.toString();
};

const fetchOfficialXml = async (
  url: string,
  signal: AbortSignal,
  fetcher: typeof fetch,
): Promise<XmlObject> => {
  const response = await fetcher(url, {
    redirect: 'error',
    headers: {
      accept: 'application/gml+xml, application/xml, text/xml',
      'user-agent': 'Watcher OSINT/1.0 (public research)',
    },
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  });
  if (!response.ok) throw sourceHttpError(response, url);
  const declaredLength = Number(response.headers.get('content-length') ?? '0');
  if (declaredLength > maxResponseBytes)
    throw new Error('ČÚZK WFS response exceeded response size limit');
  if (!response.body) throw new Error('ČÚZK WFS returned an empty body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxResponseBytes)
        throw new Error('ČÚZK WFS response exceeded response size limit');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const xml = new TextDecoder().decode(bytes);
  if (/<!DOCTYPE/iu.test(xml))
    throw new Error('ČÚZK WFS XML contains a DOCTYPE');
  const validation = XMLValidator.validate(xml);
  if (validation !== true) throw new Error('ČÚZK WFS returned malformed XML');
  const parsed: unknown = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
  }).parse(xml);
  if (!isObject(parsed)) throw new Error('ČÚZK WFS returned invalid XML data');
  return parsed;
};

const directReference = (
  root: XmlObject,
  element: string,
  prefix: 'BU' | 'CP' | 'CZ',
) => namedObjects(root, element).map((node) => referenceId(node, prefix))[0];

const selectorFor = (
  type: Selector['type'],
  value: string,
  parent: Selector,
): Selector => ({
  type,
  value,
  original: value,
  depth: parent.depth + 1,
});

const addressPlaceDocument = (
  node: XmlObject,
  selector: Selector,
  sourceUrl: string,
): EvidenceDocument | undefined => {
  const id = attribute(node, 'id') ?? firstNamedText(node, 'localId');
  if (!id?.match(/^AD\.\d+$/u)) return undefined;
  const label = firstNamedText(node, 'alternativeIdentifier');
  const validFrom = firstNamedText(node, 'validFrom');
  const parcelId = directReference(node, 'parcel', 'CP');
  const buildingId = directReference(node, 'building', 'BU');
  const address: EntityRef = {
    kind: 'ADDRESS',
    key: `ruian-address:${id.slice(3)}`,
    label: label ?? `Adresní místo ${id}`,
  };
  const parcel: EntityRef | undefined = parcelId
    ? {
        kind: 'CADASTRAL_PARCEL',
        key: `cuzk-parcel:${parcelId}`,
        label: `Parcela ${parcelId}`,
      }
    : undefined;
  const building: EntityRef | undefined = buildingId
    ? {
        kind: 'BUILDING',
        key: `cuzk-building:${buildingId}`,
        label: `Budova ${buildingId}`,
      }
    : undefined;
  return {
    sourceKey: `cuzk:address-place:${id}`,
    sourceUrl,
    excerpt:
      `ČÚZK adresní místo ${label ?? id}` +
      `${buildingId ? ` · budova ${buildingId}` : ''}` +
      `${parcelId ? ` · parcela ${parcelId}` : ''}`,
    data: {
      query: selector.value,
      inspireId: id,
      address: label ?? null,
      buildingId: buildingId ?? null,
      cadastralParcelId: parcelId ?? null,
      validFrom: validFrom ?? null,
    },
    findings: [
      { entity: address, predicate: 'INSPIRE_ID', value: id },
      ...(label
        ? [{ entity: address, predicate: 'OFFICIAL_ADDRESS', value: label }]
        : []),
    ],
    links: [
      ...(building
        ? [{ from: address, to: building, type: 'ADDRESS_OF_BUILDING' }]
        : []),
      ...(parcel
        ? [{ from: address, to: parcel, type: 'ADDRESS_LOCATED_ON_PARCEL' }]
        : []),
    ],
    discoveredSelectors: parcelId
      ? [selectorFor('CADASTRAL_PARCEL', parcelId, selector)]
      : [],
  };
};

const parcelDocument = (
  node: XmlObject,
  selector: Selector,
  sourceUrl: string,
): EvidenceDocument | undefined => {
  const id = attribute(node, 'id') ?? firstNamedText(node, 'localId');
  if (!id?.match(/^CP\.\d+$/u)) return undefined;
  const number = firstNamedText(node, 'label');
  const cadastralReference = firstNamedText(node, 'nationalCadastralReference');
  const area = Number(firstNamedText(node, 'areaValue'));
  const changedAt = firstNamedText(node, 'beginLifespanVersion');
  const zoningId = directReference(node, 'zoning', 'CZ');
  const zoningNode = namedObjects(node, 'zoning')[0];
  const zoningName = zoningNode ? attribute(zoningNode, 'title') : undefined;
  const parcel: EntityRef = {
    kind: 'CADASTRAL_PARCEL',
    key: `cuzk-parcel:${id}`,
    label: `Parcela ${cadastralReference ?? number ?? id}`,
  };
  const zoning: EntityRef | undefined = zoningId
    ? {
        kind: 'CADASTRAL_AREA',
        key: `cuzk-cadastral-area:${zoningId}`,
        label: zoningName ?? `Katastrální území ${zoningId}`,
      }
    : undefined;
  return {
    sourceKey: `cuzk:parcel:${id}`,
    sourceUrl,
    excerpt:
      `ČÚZK parcela ${cadastralReference ?? number ?? id}` +
      `${Number.isFinite(area) ? ` · ${area} m²` : ''}` +
      `${zoningName ? ` · k. ú. ${zoningName}` : ''}`,
    data: {
      query: selector.value,
      inspireId: id,
      parcelNumber: number ?? null,
      nationalCadastralReference: cadastralReference ?? null,
      areaSquareMetres: Number.isFinite(area) ? area : null,
      cadastralAreaId: zoningId ?? null,
      cadastralArea: zoningName ?? null,
      changedAt: changedAt ?? null,
    },
    findings: [
      { entity: parcel, predicate: 'INSPIRE_ID', value: id },
      ...(cadastralReference
        ? [
            {
              entity: parcel,
              predicate: 'NATIONAL_CADASTRAL_REFERENCE',
              value: cadastralReference,
            },
          ]
        : []),
      ...(Number.isFinite(area)
        ? [
            {
              entity: parcel,
              predicate: 'AREA_SQUARE_METRES',
              value: String(area),
            },
          ]
        : []),
    ],
    links:
      zoning === undefined
        ? []
        : [{ from: parcel, to: zoning, type: 'LOCATED_IN_CADASTRAL_AREA' }],
    discoveredSelectors: zoningId
      ? [selectorFor('CADASTRAL_AREA', zoningId, selector)]
      : [],
  };
};

const externalReference = (
  node: XmlObject,
  systemFragment: string,
): string | undefined => {
  const reference = namedObjects(node, 'ExternalReference').find((item) =>
    (firstNamedText(item, 'informationSystem') ?? '').includes(systemFragment),
  );
  return reference ? firstNamedText(reference, 'reference') : undefined;
};

const buildingDocument = (
  node: XmlObject,
  selector: Selector,
  sourceUrl: string,
): EvidenceDocument | undefined => {
  const id = attribute(node, 'id') ?? firstNamedText(node, 'localId');
  if (!id?.match(/^BU\.\d+$/u)) return undefined;
  const nameNode = namedObjects(node, 'name')[0];
  const name = firstNamedText(nameNode, 'text');
  const units = Number(firstNamedText(node, 'numberOfBuildingUnits'));
  const officialArea = Number(firstNamedText(node, 'value'));
  const changedAt = firstNamedText(node, 'beginLifespanVersion');
  const conditionNode = namedObjects(node, 'conditionOfConstruction')[0];
  const condition = conditionNode
    ? attribute(conditionNode, 'title')
    : undefined;
  const useNode = namedObjects(node, 'CurrentUse')[0];
  const currentUseNode = useNode
    ? namedObjects(useNode, 'currentUse')[0]
    : undefined;
  const currentUse = currentUseNode
    ? attribute(currentUseNode, 'title')
    : undefined;
  const parcelId = directReference(node, 'cadastralParcel', 'CP');
  const isknReference = externalReference(node, 'nahlizenidokn.cuzk');
  const isuiReference = externalReference(node, 'vdp.cuzk');
  const building: EntityRef = {
    kind: 'BUILDING',
    key: `cuzk-building:${id}`,
    label: name ? `${name} (${id})` : `Budova ${id}`,
  };
  const parcel: EntityRef | undefined = parcelId
    ? {
        kind: 'CADASTRAL_PARCEL',
        key: `cuzk-parcel:${parcelId}`,
        label: `Parcela ${parcelId}`,
      }
    : undefined;
  const facilityCode = selector.value.match(/^SO\.(\d+)$/u)?.[1];
  const ruianBuilding: EntityRef | undefined = facilityCode
    ? {
        kind: 'BUILDING',
        key: `ruian-building:${facilityCode}`,
        label: `RÚIAN stavební objekt ${facilityCode}`,
      }
    : undefined;
  return {
    sourceKey: `cuzk:building:${id}`,
    sourceUrl,
    excerpt:
      `ČÚZK budova ${name ?? id}` +
      `${Number.isFinite(officialArea) ? ` · zastavěná plocha ${officialArea} m²` : ''}` +
      `${parcelId ? ` · parcela ${parcelId}` : ''}`,
    data: {
      query: selector.value,
      inspireId: id,
      name: name ?? null,
      condition: condition ?? null,
      currentUse: currentUse ?? null,
      buildingUnits: Number.isFinite(units) ? units : null,
      officialAreaSquareMetres: Number.isFinite(officialArea)
        ? officialArea
        : null,
      cadastralParcelId: parcelId ?? null,
      ruianBuildingCode: facilityCode ?? null,
      isknReference: isknReference ?? null,
      isuiReference: isuiReference ?? null,
      changedAt: changedAt ?? null,
    },
    findings: [
      { entity: building, predicate: 'INSPIRE_ID', value: id },
      ...(name
        ? [{ entity: building, predicate: 'OFFICIAL_NAME', value: name }]
        : []),
      ...(isknReference
        ? [
            {
              entity: building,
              predicate: 'PUBLIC_ISKN_REFERENCE',
              value: isknReference,
            },
          ]
        : []),
    ],
    links: [
      ...(ruianBuilding
        ? [
            {
              from: ruianBuilding,
              to: building,
              type: 'RESOLVES_TO_INSPIRE_BUILDING',
            },
          ]
        : []),
      ...(parcel
        ? [{ from: building, to: parcel, type: 'LOCATED_ON_PARCEL' }]
        : []),
    ],
    discoveredSelectors: parcelId
      ? [selectorFor('CADASTRAL_PARCEL', parcelId, selector)]
      : [],
  };
};

const cadastralAreaDocument = (
  node: XmlObject,
  selector: Selector,
  sourceUrl: string,
): EvidenceDocument | undefined => {
  const id = attribute(node, 'id') ?? firstNamedText(node, 'localId');
  if (!id?.match(/^CZ\.\d+$/u)) return undefined;
  const name = firstNamedText(node, 'label');
  const nationalReference =
    firstNamedText(node, 'nationalCadastalZoningReference') ??
    firstNamedText(node, 'nationalCadastralZoningReference');
  const mapScale = Number(firstNamedText(node, 'originalMapScaleDenominator'));
  const changedAt = firstNamedText(node, 'beginLifespanVersion');
  const entity: EntityRef = {
    kind: 'CADASTRAL_AREA',
    key: `cuzk-cadastral-area:${id}`,
    label: name ?? `Katastrální území ${id}`,
  };
  return {
    sourceKey: `cuzk:cadastral-area:${id}`,
    sourceUrl,
    excerpt:
      `ČÚZK katastrální území ${name ?? id}` +
      `${nationalReference ? ` · kód ${nationalReference}` : ''}`,
    data: {
      query: selector.value,
      inspireId: id,
      name: name ?? null,
      nationalReference: nationalReference ?? null,
      originalMapScaleDenominator: Number.isFinite(mapScale) ? mapScale : null,
      changedAt: changedAt ?? null,
    },
    findings: [
      { entity, predicate: 'INSPIRE_ID', value: id },
      ...(name
        ? [
            {
              entity,
              predicate: 'CADASTRAL_AREA_NAME',
              value: name,
            },
          ]
        : []),
    ],
    links: [],
  };
};

export const createCuzkAddressPlaceCollector = (
  fetcher: typeof fetch = fetch,
): Collector => ({
  id: 'CUZK_ADDRESS_PLACE',
  supports: ['ADDRESS_PLACE'],
  priority: 100,
  collect: async (selector, signal) => {
    const sourceUrl = buildWfsUrl(addressEndpoint, {
      storedQuery_id: 'GetFeatureById',
      ID: selector.value,
    });
    const xml = await fetchOfficialXml(sourceUrl, signal, fetcher);
    return namedObjects(xml, 'Address')
      .slice(0, 10)
      .map((node) => addressPlaceDocument(node, selector, sourceUrl))
      .filter((document): document is EvidenceDocument => Boolean(document));
  },
});

export const createCuzkParcelCollector = (
  fetcher: typeof fetch = fetch,
): Collector => ({
  id: 'CUZK_CADASTRAL_PARCEL',
  supports: ['CADASTRAL_PARCEL'],
  priority: 99,
  collect: async (selector, signal) => {
    const parameters = selector.value.startsWith('CP.')
      ? { storedQuery_id: 'GetFeatureById', ID: selector.value }
      : (() => {
          const [areaCode, parcelNumber] = selector.value.split('|');
          if (!areaCode || !parcelNumber)
            throw new Error('Invalid cadastral parcel selector');
          return {
            storedQuery_id: 'GetParcel',
            UPPER_ZONING_ID: areaCode,
            TEXT: parcelNumber,
          };
        })();
    const sourceUrl = buildWfsUrl(parcelEndpoint, parameters);
    const xml = await fetchOfficialXml(sourceUrl, signal, fetcher);
    return namedObjects(xml, 'CadastralParcel')
      .slice(0, 10)
      .map((node) => parcelDocument(node, selector, sourceUrl))
      .filter((document): document is EvidenceDocument => Boolean(document));
  },
});

export const createCuzkBuildingCollector = (
  fetcher: typeof fetch = fetch,
): Collector => ({
  id: 'CUZK_BUILDING',
  supports: ['BUILDING'],
  priority: 98,
  collect: async (selector, signal) => {
    const facilityCode = selector.value.match(/^SO\.(\d+)$/u)?.[1];
    const sourceUrl = buildWfsUrl(
      buildingEndpoint,
      facilityCode
        ? {
            storedQuery_id: 'GetBuildingByFacilityCode',
            SO_CODE: facilityCode,
          }
        : { storedQuery_id: 'GetFeatureById', ID: selector.value },
    );
    const xml = await fetchOfficialXml(sourceUrl, signal, fetcher);
    return namedObjects(xml, 'Building')
      .slice(0, 10)
      .map((node) => buildingDocument(node, selector, sourceUrl))
      .filter((document): document is EvidenceDocument => Boolean(document));
  },
});

export const createCuzkCadastralAreaCollector = (
  fetcher: typeof fetch = fetch,
): Collector => ({
  id: 'CUZK_CADASTRAL_AREA',
  supports: ['CADASTRAL_AREA'],
  priority: 97,
  collect: async (selector, signal) => {
    const parameters = selector.value.startsWith('CZ.')
      ? { storedQuery_id: 'GetFeatureById', ID: selector.value }
      : { storedQuery_id: 'GetZoningByName', ZONING_NAME: selector.value };
    const sourceUrl = buildWfsUrl(parcelEndpoint, parameters);
    const xml = await fetchOfficialXml(sourceUrl, signal, fetcher);
    return namedObjects(xml, 'CadastralZoning')
      .slice(0, 10)
      .map((node) => cadastralAreaDocument(node, selector, sourceUrl))
      .filter((document): document is EvidenceDocument => Boolean(document));
  },
});
