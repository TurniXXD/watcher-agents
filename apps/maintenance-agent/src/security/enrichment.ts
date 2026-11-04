import { z } from 'zod';
type EnrichmentTarget = {
  identifiers: string[];
  epss?: { probability: number; percentile: number; source: 'FIRST' };
  kev?: {
    listed: boolean;
    source: 'CISA';
    dateAdded?: string;
    requiredAction?: string;
    dueDate?: string;
    knownRansomwareCampaignUse?: string;
  };
};

const kevSchema = z.object({
  vulnerabilities: z.array(
    z.object({
      cveID: z.string().regex(/^CVE-\d{4}-\d{4,}$/u),
      dateAdded: z.iso.date(),
      requiredAction: z.string().min(1),
      dueDate: z.iso.date(),
      knownRansomwareCampaignUse: z.string().min(1),
    }),
  ),
});

const epssSchema = z.object({
  data: z.array(
    z.object({
      cve: z.string().regex(/^CVE-\d{4}-\d{4,}$/u),
      epss: z.string().regex(/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/u),
      percentile: z.string().regex(/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/u),
    }),
  ),
});

const cveIds = (advisories: readonly EnrichmentTarget[]): string[] => [
  ...new Set(
    advisories.flatMap((advisory) =>
      advisory.identifiers.filter((id) => /^CVE-\d{4}-\d{4,}$/u.test(id)),
    ),
  ),
];

export class SecurityEnricher {
  public constructor(private readonly fetcher: typeof fetch = fetch) {}

  private async fetchJson(url: string): Promise<unknown> {
    const response = await this.fetcher(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new Error(`Enrichment source returned HTTP ${response.status}`);
    return response.json();
  }

  public async enrich<T extends EnrichmentTarget>(
    advisories: readonly T[],
  ): Promise<T[]> {
    const cves = cveIds(advisories);
    const epssBatches = Array.from(
      { length: Math.ceil(cves.length / 100) },
      (_, index) => cves.slice(index * 100, index * 100 + 100),
    );
    const requests: Array<
      Promise<
        | { kind: 'KEV'; value: z.infer<typeof kevSchema> }
        | { kind: 'EPSS'; value: z.infer<typeof epssSchema> }
      >
    > = [
      this.fetchJson(
        'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
      ).then((value) => ({ kind: 'KEV', value: kevSchema.parse(value) })),
      ...epssBatches.map((batch) =>
        this.fetchJson(
          `https://api.first.org/data/v1/epss?cve=${encodeURIComponent(batch.join(','))}`,
        ).then((value) => ({
          kind: 'EPSS' as const,
          value: epssSchema.parse(value),
        })),
      ),
    ];
    const settled = await Promise.allSettled(requests);
    const kevPayload = settled.find(
      (result) => result.status === 'fulfilled' && result.value.kind === 'KEV',
    );
    const kev =
      kevPayload?.status === 'fulfilled' && kevPayload.value.kind === 'KEV'
        ? new Map(
            kevPayload.value.value.vulnerabilities.map((item) => [
              item.cveID,
              item,
            ]),
          )
        : undefined;
    const epssEntries = settled.flatMap((result) =>
      result.status === 'fulfilled' && result.value.kind === 'EPSS'
        ? result.value.value.data
        : [],
    );
    const epss = epssEntries.length
      ? new Map(epssEntries.map((item) => [item.cve, item]))
      : undefined;
    return advisories.map((advisory): T => {
      const cve = advisory.identifiers.find((id) => id.startsWith('CVE-'));
      const kevEntry = cve ? kev?.get(cve) : undefined;
      const epssEntry = cve ? epss?.get(cve) : undefined;
      return {
        ...advisory,
        ...(epssEntry
          ? {
              epss: {
                probability: Number(epssEntry.epss),
                percentile: Number(epssEntry.percentile),
                source: 'FIRST' as const,
              },
            }
          : {}),
        ...(kev
          ? {
              kev: kevEntry
                ? {
                    listed: true,
                    source: 'CISA' as const,
                    dateAdded: kevEntry.dateAdded,
                    requiredAction: kevEntry.requiredAction,
                    dueDate: kevEntry.dueDate,
                    knownRansomwareCampaignUse:
                      kevEntry.knownRansomwareCampaignUse,
                  }
                : { listed: false, source: 'CISA' as const },
            }
          : {}),
      };
    });
  }
}
