import { describe, expect, it, vi } from 'vitest';
import { SecurityEnricher } from '../security/enrichment.js';
import { OsvClient } from '../security/osv.js';
import { NvdClient } from '../security/nvd.js';
import { TechnologyWatchService } from '../security/technology-watch.js';
import {
  parseTechnologyWatchlist,
  type TechnologyWatchEntry,
} from '../security/watchlist.js';

const requestUrl = (input: string | URL | Request): string =>
  typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

const nextWatch: TechnologyWatchEntry = {
  id: 'nextjs',
  ecosystem: 'JavaScript',
  vendor: 'Vercel',
  project: 'Next.js',
  package: { ecosystem: 'npm', name: 'next' },
  versions: ['15.0.0'],
  officialAdvisorySources: [
    'https://github.com/vercel/next.js/security/advisories',
  ],
  matchingStrategy: 'OSV_PACKAGE',
  deploymentResponsibility: 'PATCHABLE',
  enabled: true,
};

const osvRecord = {
  id: 'GHSA-aaaa-bbbb-cccc',
  aliases: ['CVE-2026-1234'],
  modified: '2026-11-03T10:00:00Z',
  published: '2026-11-02T10:00:00Z',
  summary: 'Next.js request handling issue',
  details: 'Untrusted advisory content.',
  affected: [
    {
      package: { ecosystem: 'npm', name: 'next' },
      ranges: [
        {
          type: 'SEMVER',
          events: [{ introduced: '14.0.0' }, { fixed: '15.0.1' }],
        },
      ],
      versions: ['15.0.0'],
    },
  ],
  severity: [
    {
      type: 'CVSS_V3',
      score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
    },
  ],
  references: [
    {
      type: 'ADVISORY',
      url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
    },
  ],
};

describe('technology vulnerability watch', () => {
  it('requires structured package or CPE identity and rejects keyword matching', () => {
    expect(() =>
      parseTechnologyWatchlist([
        {
          id: 'bad',
          ecosystem: 'cloud',
          vendor: 'Vendor',
          project: 'Product',
          officialAdvisorySources: ['https://example.test/security'],
          matchingStrategy: 'KEYWORD',
          deploymentResponsibility: 'PATCHABLE',
          enabled: true,
        },
      ]),
    ).toThrow();
    expect(parseTechnologyWatchlist([nextWatch])).toHaveLength(1);
  });

  it('queries OSV by exact package/version and preserves advisory boundaries', async () => {
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url.endsWith('/v1/query')) {
          if (typeof init?.body !== 'string') {
            throw new TypeError('Expected a JSON request body');
          }
          expect(JSON.parse(init.body) as unknown).toEqual({
            package: { ecosystem: 'npm', name: 'next' },
            version: '15.0.0',
          });
          return Response.json({
            vulns: [{ id: osvRecord.id, modified: osvRecord.modified }],
          });
        }
        if (url.endsWith(`/v1/vulns/${osvRecord.id}`))
          return Response.json(osvRecord);
        throw new Error(`Unexpected URL ${url}`);
      },
    );

    const advisories = await new OsvClient(fetcher).advisoriesFor(nextWatch);

    expect(advisories).toEqual([
      expect.objectContaining({
        category: 'TECHNOLOGY_WATCH',
        technologyId: 'nextjs',
        identifiers: ['GHSA-aaaa-bbbb-cccc', 'CVE-2026-1234'],
        affectedVersions: ['>=14.0.0', '15.0.0'],
        fixedVersions: ['15.0.1'],
        requiresDeploymentVerification: true,
        source: 'OSV',
      }),
    ]);
  });

  it('enriches CVEs with sourced EPSS and KEV data without inventing missing scores', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = requestUrl(input);
      if (url.includes('known_exploited_vulnerabilities.json')) {
        return Response.json({
          title: 'CISA Known Exploited Vulnerabilities Catalog',
          catalogVersion: '2026.11.04',
          dateReleased: '2026-11-04T00:00:00Z',
          count: 1,
          vulnerabilities: [
            {
              cveID: 'CVE-2026-1234',
              vendorProject: 'Vercel',
              product: 'Next.js',
              vulnerabilityName: 'Next.js vulnerability',
              dateAdded: '2026-11-04',
              shortDescription: 'Known exploited issue.',
              requiredAction: 'Apply vendor update.',
              dueDate: '2026-11-25',
              knownRansomwareCampaignUse: 'Unknown',
              notes: '',
            },
          ],
        });
      }
      if (url.includes('api.first.org/data/v1/epss')) {
        return Response.json({
          status: 'OK',
          'status-code': 200,
          version: '1.0',
          access: 'public',
          total: 1,
          offset: 0,
          limit: 100,
          data: [
            {
              cve: 'CVE-2026-1234',
              epss: '0.812300000',
              percentile: '0.991000000',
              date: '2026-11-04',
            },
          ],
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const advisory = (
      await new OsvClient(async (input) => {
        const url = requestUrl(input);
        return url.endsWith('/v1/query')
          ? Response.json({ vulns: [{ id: osvRecord.id }] })
          : Response.json(osvRecord);
      }).advisoriesFor(nextWatch)
    )[0]!;

    const [enriched, missing] = await new SecurityEnricher(fetcher).enrich([
      advisory,
      { ...advisory, identifiers: ['GHSA-no-cve'] },
    ]);

    expect(enriched).toMatchObject({
      epss: { probability: 0.8123, percentile: 0.991, source: 'FIRST' },
      kev: {
        listed: true,
        source: 'CISA',
        dateAdded: '2026-11-04',
        requiredAction: 'Apply vendor update.',
      },
    });
    expect(missing).not.toHaveProperty('epss');
    expect(missing?.kev).toEqual({ listed: false, source: 'CISA' });
  });

  it('batches large EPSS lookups while keeping enrichment sources independent', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = requestUrl(input);
      return url.includes('known_exploited_vulnerabilities.json')
        ? Response.json({ vulnerabilities: [] })
        : Response.json({ data: [] });
    });
    const targets = Array.from({ length: 101 }, (_, index) => ({
      identifiers: [`CVE-2026-${index + 1000}`],
    }));

    const enriched = await new SecurityEnricher(fetcher).enrich(targets);

    expect(
      fetcher.mock.calls.filter(([input]) =>
        requestUrl(input).includes('api.first.org/data/v1/epss'),
      ),
    ).toHaveLength(2);
    expect(enriched[0]).toMatchObject({
      kev: { listed: false, source: 'CISA' },
    });
  });

  it('isolates failed watch sources and excludes provider-managed status incidents', async () => {
    const watchlist = parseTechnologyWatchlist([
      nextWatch,
      {
        id: 'cloudflare-service',
        ecosystem: 'Cloud',
        vendor: 'Cloudflare',
        project: 'Managed edge network',
        officialAdvisorySources: ['https://www.cloudflarestatus.com/'],
        matchingStrategy: 'OFFICIAL_PROVIDER',
        deploymentResponsibility: 'PROVIDER_MANAGED',
        enabled: true,
      },
      {
        ...nextWatch,
        id: 'failing-package',
        package: { ecosystem: 'npm', name: 'broken' },
      },
    ]);
    const source = {
      advisoriesFor: vi.fn(async (entry: { id: string }) => {
        if (entry.id === 'failing-package') throw new Error('OSV unavailable');
        if (entry.id === 'cloudflare-service') return [];
        return [
          {
            category: 'TECHNOLOGY_WATCH' as const,
            technologyId: entry.id,
            technology: 'Next.js',
            identifiers: ['GHSA-aaaa-bbbb-cccc'],
            affectedVersions: [],
            fixedVersions: [],
            publishedAt: new Date('2026-11-02T10:00:00Z'),
            modifiedAt: new Date('2026-11-03T10:00:00Z'),
            severity: [],
            references: [],
            source: 'OSV' as const,
            potentialRelevance: 'Structured package identity matched.',
            requiresDeploymentVerification: true as const,
          },
        ];
      }),
    };

    const result = await new TechnologyWatchService(source).collect(watchlist);

    expect(result.advisories).toHaveLength(1);
    expect(result.failures).toEqual([
      { technologyId: 'failing-package', error: 'OSV unavailable' },
    ]);
    expect(result.advisories[0]?.technologyId).toBe('nextjs');
  });

  it('queries NVD with a structured CPE and preserves sourced CVSS values', async () => {
    const linux = parseTechnologyWatchlist([
      {
        id: 'linux-kernel',
        ecosystem: 'Operating system',
        vendor: 'Linux',
        project: 'kernel',
        cpe: 'cpe:2.3:o:linux:linux_kernel:*:*:*:*:*:*:*:*',
        officialAdvisorySources: [
          'https://www.kernel.org/category/releases.html',
        ],
        matchingStrategy: 'NVD_CPE',
        deploymentResponsibility: 'PATCHABLE',
        enabled: true,
      },
    ])[0]!;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      expect(requestUrl(input)).toContain(
        'virtualMatchString=cpe%3A2.3%3Ao%3Alinux%3Alinux_kernel',
      );
      return Response.json({
        resultsPerPage: 1,
        startIndex: 0,
        totalResults: 1,
        format: 'NVD_CVE',
        version: '2.0',
        timestamp: '2026-11-04T10:00:00.000',
        vulnerabilities: [
          {
            cve: {
              id: 'CVE-2026-7777',
              published: '2026-11-01T10:00:00.000',
              lastModified: '2026-11-03T10:00:00.000',
              descriptions: [{ lang: 'en', value: 'Kernel issue.' }],
              metrics: {
                cvssMetricV31: [
                  {
                    source: 'nvd@nist.gov',
                    type: 'Primary',
                    cvssData: {
                      version: '3.1',
                      vectorString:
                        'CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H',
                      baseScore: 7.8,
                      baseSeverity: 'HIGH',
                    },
                  },
                ],
              },
              references: [
                { url: 'https://nvd.nist.gov/vuln/detail/CVE-2026-7777' },
              ],
              configurations: [
                {
                  nodes: [
                    {
                      cpeMatch: [
                        {
                          vulnerable: true,
                          criteria: linux.cpe,
                          versionStartIncluding: '6.0',
                          versionEndExcluding: '6.12.5',
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        ],
      });
    });

    const advisories = await new NvdClient(fetcher).advisoriesFor(linux);

    expect(advisories[0]).toMatchObject({
      identifiers: ['CVE-2026-7777'],
      affectedVersions: ['>=6.0 <6.12.5'],
      fixedVersions: ['6.12.5'],
      severity: [
        {
          source: 'nvd@nist.gov',
          type: 'CVSS_V3.1:HIGH:7.8',
          vector: 'CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H',
        },
      ],
      requiresDeploymentVerification: true,
    });
  });
});
