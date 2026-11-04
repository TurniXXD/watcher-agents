import { z } from 'zod';
import type { TechnologyWatchEntry } from './watchlist.js';

const queryResponseSchema = z.object({
  vulns: z
    .array(
      z.object({
        id: z.string().min(1),
        modified: z.iso.datetime({ offset: true }).optional(),
      }),
    )
    .optional(),
});

const osvRecordSchema = z.object({
  id: z.string().min(1),
  aliases: z.array(z.string().min(1)).optional(),
  modified: z.iso.datetime({ offset: true }),
  published: z.iso.datetime({ offset: true }).optional(),
  summary: z.string().min(1).optional(),
  details: z.string().optional(),
  affected: z
    .array(
      z.object({
        package: z.object({
          ecosystem: z.string().min(1),
          name: z.string().min(1),
          purl: z.string().min(1).optional(),
        }),
        ranges: z
          .array(
            z.object({
              type: z.string().min(1),
              events: z.array(
                z.object({
                  introduced: z.string().optional(),
                  fixed: z.string().optional(),
                  last_affected: z.string().optional(),
                  limit: z.string().optional(),
                }),
              ),
            }),
          )
          .optional(),
        versions: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  severity: z
    .array(z.object({ type: z.string().min(1), score: z.string().min(1) }))
    .optional(),
  references: z
    .array(z.object({ type: z.string().min(1), url: z.url() }))
    .optional(),
});

export type TechnologyAdvisory = {
  category: 'TECHNOLOGY_WATCH';
  technologyId: string;
  technology: string;
  identifiers: string[];
  title?: string;
  description?: string;
  affectedVersions: string[];
  fixedVersions: string[];
  publishedAt?: Date;
  modifiedAt: Date;
  severity: Array<{ source: string; type: string; vector: string }>;
  references: string[];
  source: 'OSV' | 'NVD' | 'OFFICIAL_VENDOR';
  potentialRelevance: string;
  requiresDeploymentVerification: true;
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

const unique = (values: readonly (string | undefined)[]): string[] => [
  ...new Set(values.filter((value): value is string => Boolean(value))),
];

const normalizeRecord = (
  record: z.infer<typeof osvRecordSchema>,
  technology: TechnologyWatchEntry,
): TechnologyAdvisory => {
  const affected = record.affected ?? [];
  const affectedVersions = unique([
    ...affected.flatMap((item) =>
      (item.ranges ?? []).flatMap((range) =>
        range.events.flatMap((event) =>
          event.introduced && event.introduced !== '0'
            ? [`>=${event.introduced}`]
            : event.last_affected
              ? [`<=${event.last_affected}`]
              : [],
        ),
      ),
    ),
    ...affected.flatMap((item) => item.versions ?? []),
  ]);
  const fixedVersions = unique(
    affected.flatMap((item) =>
      (item.ranges ?? []).flatMap((range) =>
        range.events.flatMap((event) => (event.fixed ? [event.fixed] : [])),
      ),
    ),
  ).sort();
  return {
    category: 'TECHNOLOGY_WATCH',
    technologyId: technology.id,
    technology: `${technology.vendor} ${technology.project}`,
    identifiers: unique([record.id, ...(record.aliases ?? [])]),
    ...(record.summary ? { title: record.summary } : {}),
    ...(record.details ? { description: record.details } : {}),
    affectedVersions,
    fixedVersions,
    ...(record.published ? { publishedAt: new Date(record.published) } : {}),
    modifiedAt: new Date(record.modified),
    severity: (record.severity ?? []).map((severity) => ({
      source: 'OSV',
      type: severity.type,
      vector: severity.score,
    })),
    references: unique((record.references ?? []).map((item) => item.url)),
    source: 'OSV',
    potentialRelevance: technology.versions?.length
      ? `OSV matched the configured ${technology.package?.ecosystem ?? 'package'} identity and version.`
      : 'OSV matched the configured structured package identity; the deployed version still needs verification.',
    requiresDeploymentVerification: true,
  };
};

export class OsvClient {
  public constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly baseUrl = 'https://api.osv.dev',
  ) {}

  private async json(url: string, init?: RequestInit): Promise<unknown> {
    const response = await this.fetcher(url, {
      ...init,
      signal: AbortSignal.timeout(15_000),
      headers: {
        accept: 'application/json',
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
    if (!response.ok) throw new Error(`OSV returned HTTP ${response.status}`);
    return response.json();
  }

  public async advisoriesFor(
    technology: TechnologyWatchEntry,
  ): Promise<TechnologyAdvisory[]> {
    if (
      !technology.enabled ||
      technology.matchingStrategy !== 'OSV_PACKAGE' ||
      !technology.package
    ) {
      return [];
    }
    const versions = technology.versions?.length
      ? technology.versions
      : [undefined];
    const queryResults = await Promise.all(
      versions.map(async (version) =>
        queryResponseSchema.parse(
          await this.json(`${this.baseUrl}/v1/query`, {
            method: 'POST',
            body: JSON.stringify({
              package: {
                ecosystem: technology.package!.ecosystem,
                name: technology.package!.name,
                ...(technology.package!.purl
                  ? { purl: technology.package!.purl }
                  : {}),
              },
              ...(version ? { version } : {}),
            }),
          }),
        ),
      ),
    );
    const ids = unique(
      queryResults.flatMap((result) =>
        (result.vulns ?? []).map((vulnerability) => vulnerability.id),
      ),
    );
    return Promise.all(
      ids.map(async (id) =>
        normalizeRecord(
          osvRecordSchema.parse(
            await this.json(
              `${this.baseUrl}/v1/vulns/${encodeURIComponent(id)}`,
            ),
          ),
          technology,
        ),
      ),
    );
  }
}
