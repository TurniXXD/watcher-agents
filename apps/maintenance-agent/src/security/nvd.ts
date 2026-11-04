import { z } from 'zod';
import type { TechnologyAdvisory } from './osv.js';
import type { TechnologyWatchEntry } from './watchlist.js';

const cvssDataSchema = z.object({
  version: z.string().min(1),
  vectorString: z.string().min(1),
  baseScore: z.number().finite().nonnegative(),
  baseSeverity: z.string().min(1),
});

const metricSchema = z.object({
  source: z.string().min(1),
  type: z.string().min(1),
  cvssData: cvssDataSchema,
});

const cpeMatchSchema = z.object({
  vulnerable: z.boolean(),
  criteria: z.string().min(1),
  versionStartIncluding: z.string().min(1).optional(),
  versionStartExcluding: z.string().min(1).optional(),
  versionEndIncluding: z.string().min(1).optional(),
  versionEndExcluding: z.string().min(1).optional(),
});

const nvdResponseSchema = z.object({
  vulnerabilities: z.array(
    z.object({
      cve: z.object({
        id: z.string().regex(/^CVE-\d{4}-\d{4,}$/u),
        published: z.string().min(1),
        lastModified: z.string().min(1),
        descriptions: z.array(
          z.object({ lang: z.string().min(1), value: z.string() }),
        ),
        metrics: z
          .object({
            cvssMetricV40: z.array(metricSchema).optional(),
            cvssMetricV31: z.array(metricSchema).optional(),
            cvssMetricV30: z.array(metricSchema).optional(),
          })
          .optional(),
        references: z.array(z.object({ url: z.url() })).optional(),
        configurations: z
          .array(
            z.object({
              nodes: z.array(
                z.object({
                  cpeMatch: z.array(cpeMatchSchema).optional(),
                }),
              ),
            }),
          )
          .optional(),
      }),
    }),
  ),
});

const rangeLabel = (match: z.infer<typeof cpeMatchSchema>): string => {
  const start = match.versionStartIncluding
    ? `>=${match.versionStartIncluding}`
    : match.versionStartExcluding
      ? `>${match.versionStartExcluding}`
      : undefined;
  const end = match.versionEndExcluding
    ? `<${match.versionEndExcluding}`
    : match.versionEndIncluding
      ? `<=${match.versionEndIncluding}`
      : undefined;
  return [start, end].filter(Boolean).join(' ') || match.criteria;
};

export class NvdClient {
  public constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly apiKey?: string,
    private readonly now: () => Date = () => new Date(),
    private readonly modifiedSinceDays = 7,
    private readonly limiter?: {
      run<T>(operation: () => Promise<T>): Promise<T>;
    },
  ) {}

  public async advisoriesFor(
    technology: TechnologyWatchEntry,
  ): Promise<TechnologyAdvisory[]> {
    if (
      !technology.enabled ||
      technology.matchingStrategy !== 'NVD_CPE' ||
      !technology.cpe
    ) {
      return [];
    }
    const end = this.now();
    const start = new Date(
      end.getTime() - this.modifiedSinceDays * 24 * 60 * 60 * 1_000,
    );
    const query = new URLSearchParams({
      virtualMatchString: technology.cpe,
      lastModStartDate: start.toISOString(),
      lastModEndDate: end.toISOString(),
      resultsPerPage: '2000',
    });
    const request = () =>
      this.fetcher(
        `https://services.nvd.nist.gov/rest/json/cves/2.0?${query}`,
        {
          headers: {
            accept: 'application/json',
            ...(this.apiKey ? { apiKey: this.apiKey } : {}),
          },
          signal: AbortSignal.timeout(20_000),
        },
      );
    const response = await (this.limiter
      ? this.limiter.run(request)
      : request());
    if (!response.ok) throw new Error(`NVD returned HTTP ${response.status}`);
    const parsed = nvdResponseSchema.parse(await response.json());
    return parsed.vulnerabilities.map(({ cve }): TechnologyAdvisory => {
      const matches = (cve.configurations ?? []).flatMap((configuration) =>
        configuration.nodes.flatMap((node) => node.cpeMatch ?? []),
      );
      const vulnerableMatches = matches.filter((match) => match.vulnerable);
      const metrics = [
        ...(cve.metrics?.cvssMetricV40 ?? []),
        ...(cve.metrics?.cvssMetricV31 ?? []),
        ...(cve.metrics?.cvssMetricV30 ?? []),
      ];
      const description =
        cve.descriptions.find((item) => item.lang === 'en')?.value ??
        cve.descriptions[0]?.value;
      return {
        category: 'TECHNOLOGY_WATCH',
        technologyId: technology.id,
        technology: `${technology.vendor} ${technology.project}`,
        identifiers: [cve.id],
        ...(description
          ? { title: description.slice(0, 180), description }
          : {}),
        affectedVersions: [
          ...new Set(vulnerableMatches.map((match) => rangeLabel(match))),
        ],
        fixedVersions: [
          ...new Set(
            vulnerableMatches.flatMap((match) =>
              match.versionEndExcluding ? [match.versionEndExcluding] : [],
            ),
          ),
        ],
        publishedAt: new Date(cve.published),
        modifiedAt: new Date(cve.lastModified),
        severity: metrics.map((metric) => ({
          source: metric.source,
          type: `CVSS_V${metric.cvssData.version}:${metric.cvssData.baseSeverity}:${metric.cvssData.baseScore}`,
          vector: metric.cvssData.vectorString,
        })),
        references: [
          ...new Set((cve.references ?? []).map((reference) => reference.url)),
        ],
        source: 'NVD',
        potentialRelevance:
          'NVD matched the configured CPE identity; the deployed product and version still need verification.',
        requiresDeploymentVerification: true,
      };
    });
  }
}
