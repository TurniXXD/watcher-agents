import { z } from 'zod';

const aresSearchUrl =
  'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/vyhledat';
const aresAddressSearchUrl =
  'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/standardizovane-adresy/vyhledat';

const aresSubjectSchema = z.object({
  ico: z.string().min(1),
  obchodniJmeno: z.string().optional(),
  pravniForma: z.string().optional(),
  datumVzniku: z.string().optional(),
  datumZaniku: z.string().optional(),
  datumAktualizace: z.string().optional(),
  sidlo: z
    .object({
      textovaAdresa: z.string().optional(),
      nazevObce: z.string().optional(),
    })
    .optional(),
  czNace: z.array(z.string()).optional(),
  czNace2008: z.array(z.string()).optional(),
});

const aresSearchSchema = z.object({
  pocetCelkem: z.number().int().nonnegative().optional(),
  ekonomickeSubjekty: z.array(aresSubjectSchema).optional(),
});

const aresAddressSearchSchema = z.object({
  standardizovaneAdresy: z
    .array(
      z.object({
        kodObce: z.number().int().nonnegative().optional(),
        nazevObce: z.string().optional(),
      }),
    )
    .optional(),
});

export type AresSubject = z.infer<typeof aresSubjectSchema>;
export type AresSearchResult = {
  total: number;
  subjects: AresSubject[];
};

export type AresBusinessSearchInput = {
  query: string;
  locality: string;
  limit: number;
  naceCode?: string;
};

const naceCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{1,5}$/u);

export const searchAresBusinesses = async (
  input: AresBusinessSearchInput,
  options: {
    signal?: AbortSignal;
    fetcher?: typeof fetch;
  } = {},
): Promise<AresSearchResult> => {
  const query = z.string().trim().min(1).max(120).parse(input.query);
  const locality = z.string().trim().min(1).max(120).parse(input.locality);
  const limit = z.number().int().min(1).max(50).parse(input.limit);
  const naceCode = input.naceCode
    ? naceCodeSchema.parse(input.naceCode)
    : undefined;
  const fetcher = options.fetcher ?? fetch;
  const addressResponse = await fetcher(aresAddressSearchUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      nazevObce: locality,
      typStandardizaceAdresy: 'UPLNA_STANDARDIZACE',
      start: 0,
      pocet: 10,
    }),
    signal: options.signal ?? AbortSignal.timeout(30_000),
  });
  if (!addressResponse.ok)
    throw new Error(`ARES municipality search HTTP ${addressResponse.status}`);
  const addresses = aresAddressSearchSchema.parse(
    await addressResponse.json(),
  ).standardizovaneAdresy;
  const municipalityCodes = new Set(
    (addresses ?? [])
      .filter(
        (address) =>
          address.nazevObce?.localeCompare(locality, 'cs', {
            sensitivity: 'base',
          }) === 0 && address.kodObce !== undefined,
      )
      .map((address) => address.kodObce!),
  );
  const municipalityCode =
    municipalityCodes.size === 1 ? [...municipalityCodes][0] : undefined;
  const explicitCodeQuery = /^(?:nace|geo)\s*:/iu.test(query);
  const response = await fetcher(aresSearchUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      ...(naceCode ? { czNace: [naceCode] } : {}),
      ...(!explicitCodeQuery ? { obchodniJmeno: query } : {}),
      sidlo:
        municipalityCode !== undefined
          ? { kodObce: municipalityCode }
          : { textovaAdresa: locality },
      start: 0,
      pocet: limit,
      razeni: ['obchodniJmeno'],
    }),
    signal: options.signal ?? AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`ARES business search HTTP ${response.status}`);
  const parsed = aresSearchSchema.parse(await response.json());
  const subjects = (parsed.ekonomickeSubjekty ?? [])
    .filter((subject) => !subject.datumZaniku)
    .slice(0, limit);
  return {
    total: parsed.pocetCelkem ?? subjects.length,
    subjects,
  };
};

export const searchAresSubjects = async (
  companyName: string,
  options: {
    limit?: number;
    signal?: AbortSignal;
    fetcher?: typeof fetch;
  } = {},
): Promise<AresSearchResult> => {
  const normalizedName = z.string().trim().min(1).max(200).parse(companyName);
  const limit = Math.min(50, Math.max(1, options.limit ?? 10));
  const response = await (options.fetcher ?? fetch)(aresSearchUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      obchodniJmeno: normalizedName,
      start: 0,
      pocet: limit,
    }),
    signal: options.signal ?? AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`ARES name search HTTP ${response.status}`);
  const parsed = aresSearchSchema.parse(await response.json());
  return {
    total: parsed.pocetCelkem ?? parsed.ekonomickeSubjekty?.length ?? 0,
    subjects: (parsed.ekonomickeSubjekty ?? []).slice(0, limit),
  };
};

export const findExactAresCompany = async (
  companyName: string,
  options: Parameters<typeof searchAresSubjects>[1] = {},
): Promise<AresSubject | undefined> => {
  const result = await searchAresSubjects(companyName, options);
  const exact = result.subjects.filter(
    (subject) =>
      subject.obchodniJmeno?.localeCompare(companyName, 'cs', {
        sensitivity: 'base',
      }) === 0,
  );
  return exact.length === 1 ? exact[0] : undefined;
};
