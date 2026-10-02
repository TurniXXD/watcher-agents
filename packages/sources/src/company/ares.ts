import { z } from 'zod';

const aresSearchUrl =
  'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/vyhledat';

const aresSubjectSchema = z.object({
  ico: z.string().min(1),
  obchodniJmeno: z.string().optional(),
  pravniForma: z.string().optional(),
  datumVzniku: z.string().optional(),
  datumZaniku: z.string().optional(),
  datumAktualizace: z.string().optional(),
  sidlo: z.object({ textovaAdresa: z.string().optional() }).optional(),
});

const aresSearchSchema = z.object({
  pocetCelkem: z.number().int().nonnegative().optional(),
  ekonomickeSubjekty: z.array(aresSubjectSchema).optional(),
});

export type AresSubject = z.infer<typeof aresSubjectSchema>;
export type AresSearchResult = {
  total: number;
  subjects: AresSubject[];
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
