import { z } from 'zod';
import type { Collector, EntityRef } from './types.js';
import { postOfficialJson } from './http-json.js';

const endpoint =
  'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/standardizovane-adresy/vyhledat';

const responseSchema = z.object({
  stavStandardizace: z.string().optional(),
  standardizovaneAdresy: z
    .array(
      z.object({
        kodAdresnihoMista: z.number().int().optional(),
        kodStavebnihoObjektu: z.number().int().optional(),
        kodObce: z.number().int().optional(),
        nazevObce: z.string().optional(),
        kodCastiObce: z.number().int().optional(),
        nazevCastiObce: z.string().optional(),
        kodUlice: z.number().int().optional(),
        nazevUlice: z.string().optional(),
        cisloDomovni: z.number().int().optional(),
        cisloOrientacni: z.number().int().optional(),
        cisloOrientacniPismeno: z.string().optional(),
        psc: z.number().int().optional(),
        textovaAdresa: z.string().optional(),
      }),
    )
    .optional(),
});

export const createRuianAddressCollector = (
  fetcher: typeof fetch = fetch,
): Collector => ({
  id: 'RUIAN_ADDRESS',
  supports: ['ADDRESS'],
  priority: 100,
  collect: async (selector, signal) => {
    const response = await postOfficialJson(
      endpoint,
      {
        textovaAdresa: selector.value,
        typStandardizaceAdresy: 'VYHOVUJICI_ADRESY',
        start: 0,
        pocet: 10,
      },
      responseSchema,
      signal,
      fetcher,
    );
    return (response.standardizovaneAdresy ?? [])
      .filter((address) => address.textovaAdresa)
      .slice(0, 10)
      .map((address, index) => {
        const label = address.textovaAdresa ?? selector.value;
        const stableId =
          address.kodAdresnihoMista ??
          `${label.toLocaleLowerCase('cs')}:${index + 1}`;
        const entity: EntityRef = {
          kind: 'ADDRESS',
          key: `ruian-address:${stableId}`,
          label,
        };
        const addressPlaceId = address.kodAdresnihoMista
          ? `AD.${address.kodAdresnihoMista}`
          : undefined;
        const buildingCode = address.kodStavebnihoObjektu
          ? String(address.kodStavebnihoObjektu)
          : undefined;
        const building: EntityRef | undefined = buildingCode
          ? {
              kind: 'BUILDING',
              key: `ruian-building:${buildingCode}`,
              label: `RÚIAN stavební objekt ${buildingCode}`,
            }
          : undefined;
        return {
          sourceKey: `ruian:address:${stableId}`,
          sourceUrl: endpoint,
          excerpt:
            `${label} · RÚIAN adresní místo ${address.kodAdresnihoMista ?? 'bez kódu'} · stav ${response.stavStandardizace ?? 'neuveden'}`.slice(
              0,
              900,
            ),
          data: {
            query: selector.value,
            status: response.stavStandardizace ?? null,
            address: label,
            addressPlaceCode: address.kodAdresnihoMista ?? null,
            buildingCode: address.kodStavebnihoObjektu ?? null,
            municipalityCode: address.kodObce ?? null,
            municipality: address.nazevObce ?? null,
            districtCode: address.kodCastiObce ?? null,
            district: address.nazevCastiObce ?? null,
            streetCode: address.kodUlice ?? null,
            street: address.nazevUlice ?? null,
            postalCode: address.psc ?? null,
          },
          findings: [
            {
              entity,
              predicate: 'STANDARDIZED_ADDRESS',
              value: label,
            },
            ...(address.kodAdresnihoMista
              ? [
                  {
                    entity,
                    predicate: 'RUIAN_ADDRESS_PLACE_CODE',
                    value: String(address.kodAdresnihoMista),
                  },
                ]
              : []),
          ],
          links: building
            ? [{ from: entity, to: building, type: 'ADDRESS_OF_BUILDING' }]
            : [],
          discoveredSelectors: [
            ...(addressPlaceId
              ? [
                  {
                    type: 'ADDRESS_PLACE' as const,
                    value: addressPlaceId,
                    original: addressPlaceId,
                    // Address standardization and its INSPIRE record are the
                    // same object, so this normalization does not consume a hop.
                    depth: selector.depth,
                  },
                ]
              : []),
            ...(buildingCode
              ? [
                  {
                    type: 'BUILDING' as const,
                    value: `SO.${buildingCode}`,
                    original: `SO.${buildingCode}`,
                    depth: selector.depth + 1,
                  },
                ]
              : []),
          ],
        };
      });
  },
});
