import { createHash } from 'node:crypto';
import { z } from 'zod';

const severitySchema = z.enum(['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

const cvssEntrySchema = z
  .object({
    V2Vector: z.string().min(1).optional(),
    V3Vector: z.string().min(1).optional(),
    V40Vector: z.string().min(1).optional(),
    V2Score: z.number().finite().nonnegative().optional(),
    V3Score: z.number().finite().nonnegative().optional(),
    V40Score: z.number().finite().nonnegative().optional(),
  })
  .passthrough();

const vulnerabilitySchema = z
  .object({
    VulnerabilityID: z.string().min(1),
    VendorIDs: z.array(z.string().min(1)).optional(),
    PkgName: z.string().min(1),
    PkgIdentifier: z
      .object({ PURL: z.string().min(1).optional() })
      .passthrough()
      .optional(),
    InstalledVersion: z.string().min(1),
    FixedVersion: z.string().min(1).optional(),
    Status: z.string().min(1).optional(),
    Severity: severitySchema.default('UNKNOWN'),
    SeveritySource: z.string().min(1).optional(),
    Title: z.string().min(1).optional(),
    Description: z.string().min(1).optional(),
    PrimaryURL: z.url().optional(),
    References: z.array(z.url()).optional(),
    CVSS: z.record(z.string(), cvssEntrySchema).optional(),
  })
  .passthrough();

const misconfigurationSchema = z
  .object({
    ID: z.string().min(1),
    AVDID: z.string().min(1).optional(),
    Type: z.string().min(1).optional(),
    Title: z.string().min(1),
    Description: z.string().min(1).optional(),
    Message: z.string().min(1).optional(),
    Namespace: z.string().min(1).optional(),
    Query: z.string().min(1).optional(),
    Resolution: z.string().min(1).optional(),
    Severity: severitySchema.default('UNKNOWN'),
    PrimaryURL: z.url().optional(),
    References: z.array(z.url()).optional(),
    Status: z.string().min(1).optional(),
    CauseMetadata: z
      .object({
        StartLine: z.number().int().positive().optional(),
        EndLine: z.number().int().positive().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const resultSchema = z
  .object({
    Target: z.string().min(1),
    Class: z.string().min(1).optional(),
    Type: z.string().min(1).optional(),
    Vulnerabilities: z.array(vulnerabilitySchema).optional(),
    Misconfigurations: z.array(misconfigurationSchema).optional(),
  })
  .passthrough();

const trivyReportSchema = z
  .object({
    SchemaVersion: z.literal(2),
    CreatedAt: z.iso.datetime({ offset: true }).optional(),
    ArtifactName: z.string().min(1).optional(),
    ArtifactType: z.string().min(1).optional(),
    Metadata: z
      .object({
        ImageID: z.string().min(1).optional(),
        RepoDigests: z.array(z.string().min(1)).optional(),
      })
      .passthrough()
      .optional(),
    Results: z.array(resultSchema).default([]),
  })
  .passthrough();

export type TrivyReport = z.infer<typeof trivyReportSchema>;

export type SecurityScanContext = {
  project: string;
  service: string;
  scanKey: string;
  scannedAt: Date;
};

export type SourcedCvss = {
  source: string;
  version: '2.x' | '3.x' | '3.0' | '3.1' | '4.0';
  score: number;
  vector?: string;
};

export type NormalizedSecurityFinding = {
  fingerprint: string;
  category: 'CONFIRMED_ENVIRONMENT';
  kind: 'VULNERABILITY' | 'MISCONFIGURATION';
  project: string;
  service: string;
  target: string;
  ecosystem: string;
  component: string;
  packageUrl?: string;
  installedVersion?: string;
  fixedVersion?: string;
  identifiers: string[];
  severity: z.infer<typeof severitySchema>;
  severitySource?: string;
  cvss: SourcedCvss[];
  references: string[];
  title: string;
  description?: string;
  recommendation?: string;
  scanKey: string;
  scannedAt: Date;
  evidence: Record<string, unknown>;
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

export const parseTrivyReport = (value: unknown): TrivyReport =>
  trivyReportSchema.parse(value);

const fingerprint = (...parts: string[]): string =>
  `security:${createHash('sha256').update(parts.join('\u0000')).digest('hex')}`;

const unique = (values: readonly (string | undefined)[]): string[] => [
  ...new Set(values.filter((value): value is string => Boolean(value))),
];

const cvssVersion = (
  vector: string | undefined,
  fallback: SourcedCvss['version'],
): SourcedCvss['version'] => {
  if (vector?.startsWith('CVSS:4.0/')) return '4.0';
  if (vector?.startsWith('CVSS:3.1/')) return '3.1';
  if (vector?.startsWith('CVSS:3.0/')) return '3.0';
  return fallback;
};

const cvssScores = (
  cvss: z.infer<typeof vulnerabilitySchema>['CVSS'],
): SourcedCvss[] =>
  Object.entries(cvss ?? {}).flatMap(([source, score]) => {
    const records: SourcedCvss[] = [];
    if (score.V40Score !== undefined) {
      records.push({
        source,
        version: cvssVersion(score.V40Vector, '4.0'),
        score: score.V40Score,
        ...(score.V40Vector ? { vector: score.V40Vector } : {}),
      });
    }
    if (score.V3Score !== undefined) {
      records.push({
        source,
        version: cvssVersion(score.V3Vector, '3.x'),
        score: score.V3Score,
        ...(score.V3Vector ? { vector: score.V3Vector } : {}),
      });
    }
    if (score.V2Score !== undefined) {
      records.push({
        source,
        version: '2.x',
        score: score.V2Score,
        ...(score.V2Vector ? { vector: score.V2Vector } : {}),
      });
    }
    return records;
  });

export const normalizeTrivyReport = (
  report: TrivyReport,
  context: SecurityScanContext,
): NormalizedSecurityFinding[] => {
  const normalized = report.Results.flatMap((result) => {
    const ecosystem = result.Type ?? result.Class ?? 'unknown';
    const vulnerabilities = (result.Vulnerabilities ?? []).map(
      (vulnerability): NormalizedSecurityFinding => {
        const identifiers = unique([
          vulnerability.VulnerabilityID,
          ...(vulnerability.VendorIDs ?? []),
        ]);
        const canonicalIdentifier =
          identifiers.find((identifier) => identifier.startsWith('CVE-')) ??
          identifiers.find((identifier) => identifier.startsWith('GHSA-')) ??
          vulnerability.VulnerabilityID;
        const references = unique([
          vulnerability.PrimaryURL,
          ...(vulnerability.References ?? []),
        ]);
        return {
          fingerprint: fingerprint(
            context.project,
            context.service,
            ecosystem,
            vulnerability.PkgName,
            canonicalIdentifier,
          ),
          category: 'CONFIRMED_ENVIRONMENT',
          kind: 'VULNERABILITY',
          project: context.project,
          service: context.service,
          target: result.Target,
          ecosystem,
          component: vulnerability.PkgName,
          ...(vulnerability.PkgIdentifier?.PURL
            ? { packageUrl: vulnerability.PkgIdentifier.PURL }
            : {}),
          installedVersion: vulnerability.InstalledVersion,
          ...(vulnerability.FixedVersion
            ? { fixedVersion: vulnerability.FixedVersion }
            : {}),
          identifiers,
          severity: vulnerability.Severity,
          ...(vulnerability.SeveritySource
            ? { severitySource: vulnerability.SeveritySource }
            : {}),
          cvss: cvssScores(vulnerability.CVSS),
          references,
          title:
            vulnerability.Title ??
            `${vulnerability.VulnerabilityID} affects ${vulnerability.PkgName}`,
          ...(vulnerability.Description
            ? { description: vulnerability.Description }
            : {}),
          ...(vulnerability.FixedVersion
            ? {
                recommendation: `Upgrade ${vulnerability.PkgName} to ${vulnerability.FixedVersion} or a later verified fixed version.`,
              }
            : {}),
          scanKey: context.scanKey,
          scannedAt: context.scannedAt,
          evidence: {
            scanner: 'trivy',
            artifactName: report.ArtifactName,
            artifactType: report.ArtifactType,
            targetClass: result.Class,
            status: vulnerability.Status,
          },
        };
      },
    );
    const misconfigurations = (result.Misconfigurations ?? []).map(
      (misconfiguration): NormalizedSecurityFinding => {
        const identifier = misconfiguration.AVDID ?? misconfiguration.ID;
        const description =
          misconfiguration.Description ?? misconfiguration.Message;
        return {
          fingerprint: fingerprint(
            context.project,
            context.service,
            ecosystem,
            identifier,
          ),
          category: 'CONFIRMED_ENVIRONMENT',
          kind: 'MISCONFIGURATION',
          project: context.project,
          service: context.service,
          target: result.Target,
          ecosystem,
          component: result.Target,
          identifiers: [identifier],
          severity: misconfiguration.Severity,
          cvss: [],
          references: unique([
            misconfiguration.PrimaryURL,
            ...(misconfiguration.References ?? []),
          ]),
          title: misconfiguration.Title,
          ...(description ? { description } : {}),
          ...(misconfiguration.Resolution
            ? { recommendation: misconfiguration.Resolution }
            : {}),
          scanKey: context.scanKey,
          scannedAt: context.scannedAt,
          evidence: {
            scanner: 'trivy',
            ruleId: misconfiguration.ID,
            namespace: misconfiguration.Namespace,
            query: misconfiguration.Query,
            status: misconfiguration.Status,
            cause: misconfiguration.CauseMetadata,
          },
        };
      },
    );
    return [...vulnerabilities, ...misconfigurations];
  });

  const byFingerprint = new Map<string, NormalizedSecurityFinding>();
  for (const finding of normalized) {
    const prior = byFingerprint.get(finding.fingerprint);
    if (!prior) {
      byFingerprint.set(finding.fingerprint, finding);
      continue;
    }
    const cvss = [...prior.cvss, ...finding.cvss].filter(
      (entry, index, entries) =>
        entries.findIndex(
          (candidate) =>
            candidate.source === entry.source &&
            candidate.version === entry.version &&
            candidate.score === entry.score &&
            candidate.vector === entry.vector,
        ) === index,
    );
    byFingerprint.set(finding.fingerprint, {
      ...prior,
      identifiers: unique([...prior.identifiers, ...finding.identifiers]),
      references: unique([...prior.references, ...finding.references]),
      cvss,
      ...(prior.fixedVersion || finding.fixedVersion
        ? { fixedVersion: prior.fixedVersion ?? finding.fixedVersion }
        : {}),
    });
  }
  return [...byFingerprint.values()];
};
