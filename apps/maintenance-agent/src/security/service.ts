import { createHash } from 'node:crypto';
import type { FindingInput, RecommendationInput } from '@watcher/database';
import type { TechnologyAdvisory } from './osv.js';
import {
  immediateSecurityAlert,
  type SecurityReportItem,
} from './reporting.js';
import type { SecurityEnricher } from './enrichment.js';
import {
  normalizeTrivyReport,
  parseTrivyReport,
  type NormalizedSecurityFinding,
  type SecurityScanContext,
} from './trivy.js';

type ExistingSecurityFinding = {
  id: string;
  fingerprint: string;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'IGNORED';
  evidence: unknown;
  type?: string;
  severity?: string;
  title?: string;
  firstSeenAt?: Date;
  lastSeenAt?: Date;
  updatedAt?: Date;
};

type SecurityStore = {
  listSecurityFindings(agentName?: string): Promise<ExistingSecurityFinding[]>;
  upsertFinding(
    input: FindingInput,
  ): Promise<{ id: string; firstSeenAt?: Date; lastSeenAt?: Date }>;
  resolveFindings(fingerprints: readonly string[]): Promise<{ count: number }>;
  upsertRecommendation(input: RecommendationInput): Promise<unknown>;
};

export type SecurityLifecycle = 'NEW' | 'PERSISTENT' | 'RESURFACED';

const securityScope = (context: SecurityScanContext): string =>
  `${context.project}:${context.service}`;

const advisoryScope = (technologyId: string): string =>
  `technology:${technologyId}`;

const advisoryFingerprint = (advisory: TechnologyAdvisory): string => {
  const canonical =
    advisory.identifiers.find((id) => id.startsWith('CVE-')) ??
    advisory.identifiers.find((id) => id.startsWith('GHSA-')) ??
    advisory.identifiers[0] ??
    'unknown';
  return `security:${createHash('sha256')
    .update(`${advisory.technologyId}\u0000${canonical}`)
    .digest('hex')}`;
};

const recordValue = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const stringValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined;

const stringValues = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];

const reportSeverity = (
  value: string | undefined,
): SecurityReportItem['severity'] =>
  value && ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(value)
    ? (value as SecurityReportItem['severity'])
    : 'INFO';

const reportCvss = (value: unknown): SecurityReportItem['cvss'] =>
  Array.isArray(value)
    ? value.flatMap((entry) => {
        const record = recordValue(entry);
        const source = stringValue(record?.['source']);
        const version = stringValue(record?.['version']);
        const score = record?.['score'];
        const vector = stringValue(record?.['vector']);
        return source && version && typeof score === 'number'
          ? [{ source, version, score, ...(vector ? { vector } : {}) }]
          : [];
      })
    : [];

const reportEpss = (value: unknown): SecurityReportItem['epss'] | undefined => {
  const record = recordValue(value);
  return typeof record?.['probability'] === 'number' &&
    typeof record['percentile'] === 'number'
    ? {
        probability: record['probability'],
        percentile: record['percentile'],
        source: 'FIRST',
      }
    : undefined;
};

const reportKev = (value: unknown): SecurityReportItem['kev'] | undefined => {
  const record = recordValue(value);
  return typeof record?.['listed'] === 'boolean'
    ? { listed: record['listed'], source: 'CISA' }
    : undefined;
};

const advisorySeverity = (
  advisory: TechnologyAdvisory,
): FindingInput['severity'] => {
  const scores = advisory.severity.flatMap((entry) => {
    const numeric = entry.type.match(/:(\d+(?:\.\d+)?)$/u)?.[1];
    return numeric ? [Number(numeric)] : [];
  });
  const highest = scores.length ? Math.max(...scores) : undefined;
  if (highest !== undefined && highest >= 9) return 'CRITICAL';
  if (
    (highest !== undefined && highest >= 7) ||
    advisory.kev?.listed ||
    (advisory.epss?.probability ?? 0) >= 0.7
  ) {
    return 'HIGH';
  }
  if (highest !== undefined && highest < 4) return 'LOW';
  return 'MEDIUM';
};

const belongsToScope = (
  finding: ExistingSecurityFinding,
  scope: string,
): boolean => recordValue(finding.evidence)?.['securityScope'] === scope;

const maintenanceSeverity = (
  severity: NormalizedSecurityFinding['severity'],
): FindingInput['severity'] => (severity === 'UNKNOWN' ? 'INFO' : severity);

const descriptionFor = (finding: NormalizedSecurityFinding): string => {
  if (finding.kind === 'MISCONFIGURATION') {
    return finding.description ?? `${finding.title} was detected by Trivy.`;
  }
  const fixed = finding.fixedVersion
    ? ` A verified fix is available in ${finding.fixedVersion}.`
    : ' No verified fixed version was reported.';
  return `${finding.component} ${finding.installedVersion ?? '(unknown version)'} is affected by ${finding.identifiers.join(', ')}.${fixed}`;
};

export class SecurityIntelligenceService {
  public constructor(
    private readonly store: SecurityStore,
    private readonly options: {
      enricher?: Pick<SecurityEnricher, 'enrich'>;
      immediateAlertMinimumScore?: number;
      onImmediateAlerts?: (
        items: readonly SecurityReportItem[],
        batchIdentity: string,
      ) => Promise<void>;
    } = {},
  ) {}

  public previewTrivy(
    value: unknown,
    context: SecurityScanContext,
  ): NormalizedSecurityFinding[] {
    return normalizeTrivyReport(parseTrivyReport(value), context);
  }

  public async currentReportItems(
    observedAt = new Date(),
    resolvedSince = new Date(observedAt.getTime() - 30 * 24 * 60 * 60 * 1_000),
  ): Promise<SecurityReportItem[]> {
    const findings = await this.store.listSecurityFindings();
    return findings.flatMap((finding): SecurityReportItem[] => {
      if (
        finding.status === 'IGNORED' ||
        (finding.status === 'RESOLVED' &&
          (!finding.updatedAt || finding.updatedAt < resolvedSince))
      ) {
        return [];
      }
      const evidence = recordValue(finding.evidence);
      if (!evidence) return [];
      const category = evidence['category'];
      if (
        category !== 'CONFIRMED_ENVIRONMENT' &&
        category !== 'TECHNOLOGY_WATCH'
      ) {
        return [];
      }
      const evidenceLifecycle = stringValue(evidence['lifecycle']);
      const lifecycle: SecurityReportItem['lifecycle'] =
        finding.status === 'RESOLVED'
          ? 'RESOLVED'
          : evidenceLifecycle &&
              ['NEW', 'PERSISTENT', 'RESURFACED'].includes(evidenceLifecycle)
            ? (evidenceLifecycle as SecurityReportItem['lifecycle'])
            : 'PERSISTENT';
      const component =
        stringValue(evidence['component']) ??
        stringValue(evidence['technology']) ??
        'component unavailable';
      const service = stringValue(evidence['service']);
      const installedVersion = stringValue(evidence['installedVersion']);
      const epss = reportEpss(evidence['epss']);
      const kev = reportKev(evidence['kev']);
      const fixedVersion = stringValue(evidence['fixedVersion']);
      const correlationKey =
        stringValue(evidence['scanKey']) ?? stringValue(evidence['modifiedAt']);
      return [
        {
          fingerprint: finding.fingerprint,
          category,
          lifecycle,
          severity: reportSeverity(finding.severity),
          title: finding.title ?? component,
          identifiers: stringValues(evidence['identifiers']),
          subject:
            category === 'CONFIRMED_ENVIRONMENT'
              ? `${service ?? 'unknown service'}: ${component}${installedVersion ? ` ${installedVersion}` : ''}`
              : component,
          fixedVersions: stringValues(evidence['fixedVersions']).length
            ? stringValues(evidence['fixedVersions'])
            : fixedVersion
              ? [fixedVersion]
              : [],
          cvss: reportCvss(evidence['cvss']),
          ...(epss ? { epss } : {}),
          ...(kev ? { kev } : {}),
          ...(category === 'TECHNOLOGY_WATCH'
            ? { requiresDeploymentVerification: true }
            : {}),
          ...(finding.firstSeenAt
            ? {
                ageDays: Math.max(
                  0,
                  Math.floor(
                    (observedAt.getTime() - finding.firstSeenAt.getTime()) /
                      (24 * 60 * 60 * 1_000),
                  ),
                ),
              }
            : {}),
          ...(finding.firstSeenAt ? { firstSeenAt: finding.firstSeenAt } : {}),
          ...(finding.lastSeenAt ? { lastSeenAt: finding.lastSeenAt } : {}),
          ...(correlationKey ? { correlationKey } : {}),
        },
      ];
    });
  }

  public async ingestTrivy(value: unknown, context: SecurityScanContext) {
    const parsedFindings = this.previewTrivy(value, context);
    const findings = this.options.enricher
      ? await this.options.enricher.enrich(parsedFindings)
      : parsedFindings;
    const scope = securityScope(context);
    const existing = (await this.store.listSecurityFindings()).filter(
      (finding) => belongsToScope(finding, scope),
    );
    const existingByFingerprint = new Map(
      existing.map((finding) => [finding.fingerprint, finding]),
    );
    const currentFingerprints = new Set(
      findings.map((finding) => finding.fingerprint),
    );
    const resolvedFingerprints = existing
      .filter(
        (finding) =>
          ['OPEN', 'ACKNOWLEDGED'].includes(finding.status) &&
          !currentFingerprints.has(finding.fingerprint),
      )
      .map((finding) => finding.fingerprint);
    await this.store.resolveFindings(resolvedFingerprints);

    const candidates = findings.map((finding) => {
      const prior = existingByFingerprint.get(finding.fingerprint);
      const lifecycle: SecurityLifecycle = !prior
        ? 'NEW'
        : prior.status === 'RESOLVED'
          ? 'RESURFACED'
          : 'PERSISTENT';
      const priorKev = recordValue(recordValue(prior?.evidence)?.['kev'])?.[
        'listed'
      ];
      const newExploitationEvidence =
        finding.kev?.listed === true && priorKev !== true;
      const reportItem: SecurityReportItem = {
        fingerprint: finding.fingerprint,
        category: 'CONFIRMED_ENVIRONMENT',
        lifecycle,
        severity: maintenanceSeverity(finding.severity),
        title: finding.title,
        identifiers: finding.identifiers,
        subject: `${finding.service}: ${finding.component}${finding.installedVersion ? ` ${finding.installedVersion}` : ''}`,
        fixedVersions: finding.fixedVersion ? [finding.fixedVersion] : [],
        cvss: finding.cvss,
        ...(finding.epss ? { epss: finding.epss } : {}),
        ...(finding.kev ? { kev: finding.kev } : {}),
        ...(newExploitationEvidence ? { newExploitationEvidence: true } : {}),
        businessCriticality: 'NORMAL',
        firstSeenAt: prior?.firstSeenAt ?? context.scannedAt,
        lastSeenAt: context.scannedAt,
        correlationKey: finding.scanKey,
      };
      return { finding, lifecycle, reportItem };
    });
    const immediateItems = candidates
      .map(({ reportItem }) => reportItem)
      .filter((reportItem) =>
        immediateSecurityAlert(reportItem, {
          minimumScore: this.options.immediateAlertMinimumScore ?? 70,
        }),
      );
    if (this.options.onImmediateAlerts && immediateItems.length > 0) {
      await this.options.onImmediateAlerts(
        immediateItems,
        JSON.stringify([context.project, context.service, context.scanKey]),
      );
    }

    const counts = {
      new: 0,
      persistent: 0,
      resurfaced: 0,
      resolved: resolvedFingerprints.length,
    };
    const reportItems: SecurityReportItem[] = [];
    for (const { finding, lifecycle, reportItem } of candidates) {
      counts[lifecycle.toLowerCase() as 'new' | 'persistent' | 'resurfaced']++;
      const saved = await this.store.upsertFinding({
        fingerprint: finding.fingerprint,
        agentName: 'maintenance-agent',
        type:
          finding.kind === 'MISCONFIGURATION'
            ? 'SECURITY_MISCONFIGURATION'
            : 'SECURITY_VULNERABILITY',
        severity: maintenanceSeverity(finding.severity),
        title: finding.title,
        description: descriptionFor(finding),
        confidence: 1,
        detectedAt: context.scannedAt,
        evidence: {
          category: finding.category,
          lifecycle,
          securityScope: scope,
          project: finding.project,
          service: finding.service,
          target: finding.target,
          ecosystem: finding.ecosystem,
          component: finding.component,
          packageUrl: finding.packageUrl,
          installedVersion: finding.installedVersion,
          fixedVersion: finding.fixedVersion,
          identifiers: finding.identifiers,
          severitySource: finding.severitySource,
          cvss: finding.cvss,
          references: finding.references,
          epss: finding.epss,
          kev: finding.kev,
          scanKey: finding.scanKey,
          scannerEvidence: finding.evidence,
        },
      });
      await this.store.upsertRecommendation({
        fingerprint: `${finding.fingerprint}:remediation`,
        findingId: saved.id,
        agentName: 'maintenance-agent',
        type:
          finding.kind === 'MISCONFIGURATION' ? 'CONFIG_CHANGE' : 'CODE_CHANGE',
        title:
          finding.recommendation ??
          `Verify vendor remediation for ${finding.component}`,
        rationale:
          finding.kind === 'MISCONFIGURATION'
            ? 'Trivy reported a failed deterministic configuration check.'
            : 'Trivy confirmed the affected package and installed version in the scanned target.',
        confidence: 1,
        ...(finding.fixedVersion
          ? {
              expectedImpact: `Remove exposure to ${finding.identifiers.join(', ')}.`,
            }
          : {}),
      });
      reportItems.push({
        ...reportItem,
        firstSeenAt: saved.firstSeenAt ?? context.scannedAt,
        lastSeenAt: saved.lastSeenAt ?? context.scannedAt,
      });
    }
    return {
      findings,
      reportItems,
      counts,
      alertFailures: [],
    };
  }

  public async ingestTechnologyAdvisories(
    advisories: readonly TechnologyAdvisory[],
    evaluatedTechnologyIds: readonly string[],
    observedAt = new Date(),
  ) {
    const uniqueAdvisories = new Map<string, TechnologyAdvisory>();
    for (const advisory of advisories) {
      const fingerprint = advisoryFingerprint(advisory);
      const prior = uniqueAdvisories.get(fingerprint);
      uniqueAdvisories.set(
        fingerprint,
        prior
          ? {
              ...prior,
              identifiers: [
                ...new Set([...prior.identifiers, ...advisory.identifiers]),
              ],
              references: [
                ...new Set([...prior.references, ...advisory.references]),
              ],
              affectedVersions: [
                ...new Set([
                  ...prior.affectedVersions,
                  ...advisory.affectedVersions,
                ]),
              ],
              fixedVersions: [
                ...new Set([...prior.fixedVersions, ...advisory.fixedVersions]),
              ],
              ...(advisory.epss ? { epss: advisory.epss } : {}),
              ...(advisory.kev ? { kev: advisory.kev } : {}),
            }
          : advisory,
      );
    }
    const current = [...uniqueAdvisories.entries()];
    const scopes = new Set(evaluatedTechnologyIds.map(advisoryScope));
    const existing = (await this.store.listSecurityFindings()).filter(
      (finding) => {
        const scope = recordValue(finding.evidence)?.['securityScope'];
        return typeof scope === 'string' && scopes.has(scope);
      },
    );
    const existingByFingerprint = new Map(
      existing.map((finding) => [finding.fingerprint, finding]),
    );
    const counts = {
      new: 0,
      persistent: 0,
      resurfaced: 0,
      resolved: 0,
    };
    const reportItems: SecurityReportItem[] = [];
    for (const [fingerprint, advisory] of current) {
      const prior = existingByFingerprint.get(fingerprint);
      const lifecycle: SecurityLifecycle = !prior
        ? 'NEW'
        : prior.status === 'RESOLVED'
          ? 'RESURFACED'
          : 'PERSISTENT';
      counts[lifecycle.toLowerCase() as 'new' | 'persistent' | 'resurfaced']++;
      const severity = advisorySeverity(advisory);
      const fixed = advisory.fixedVersions.length
        ? ` Fixed versions reported: ${advisory.fixedVersions.join(', ')}.`
        : '';
      const saved = await this.store.upsertFinding({
        fingerprint,
        agentName: 'maintenance-agent',
        type: 'TECHNOLOGY_ADVISORY',
        severity,
        title:
          advisory.title ??
          `${advisory.identifiers.join(', ')} may affect ${advisory.technology}`,
        description: `${advisory.potentialRelevance} This technology-watch advisory is not confirmed in the deployed environment; deployed-version verification is required.${fixed}`,
        confidence: 0.8,
        detectedAt: observedAt,
        evidence: {
          category: advisory.category,
          lifecycle,
          securityScope: advisoryScope(advisory.technologyId),
          technologyId: advisory.technologyId,
          technology: advisory.technology,
          identifiers: advisory.identifiers,
          affectedVersions: advisory.affectedVersions,
          fixedVersions: advisory.fixedVersions,
          publishedAt: advisory.publishedAt?.toISOString(),
          modifiedAt: advisory.modifiedAt.toISOString(),
          severity: advisory.severity,
          cvss: advisory.severity.flatMap((score) => {
            const version = score.vector.match(/^CVSS:([^/]+)\//u)?.[1];
            const numeric = score.type.match(/:(\d+(?:\.\d+)?)$/u)?.[1];
            return version && numeric
              ? [
                  {
                    source: score.source,
                    version,
                    score: Number(numeric),
                    vector: score.vector,
                  },
                ]
              : [];
          }),
          source: advisory.source,
          references: advisory.references,
          epss: advisory.epss,
          kev: advisory.kev,
          requiresDeploymentVerification:
            advisory.requiresDeploymentVerification,
        },
      });
      await this.store.upsertRecommendation({
        fingerprint: `${fingerprint}:verify-deployment`,
        findingId: saved.id,
        agentName: 'maintenance-agent',
        type: 'CODE_CHANGE',
        title: advisory.fixedVersions.length
          ? `Verify deployment and prepare upgrade to ${advisory.fixedVersions.join(' or ')}`
          : `Verify whether ${advisory.technology} is affected`,
        rationale:
          'The advisory matched a configured structured technology identity, but installed-version evidence is not available from the advisory feed.',
        confidence: 0.8,
        risk: 'Do not treat this advisory as confirmed or deploy an update until the installed version and vendor guidance are verified.',
      });
      reportItems.push({
        fingerprint,
        category: 'TECHNOLOGY_WATCH',
        lifecycle,
        severity,
        title:
          advisory.title ??
          `${advisory.identifiers.join(', ')} may affect ${advisory.technology}`,
        identifiers: advisory.identifiers,
        subject: advisory.technology,
        fixedVersions: advisory.fixedVersions,
        cvss: advisory.severity.flatMap((score) => {
          const version = score.vector.match(/^CVSS:([^/]+)\//u)?.[1];
          const numeric = score.type.match(/:(\d+(?:\.\d+)?)$/u)?.[1];
          return version && numeric
            ? [
                {
                  source: score.source,
                  version,
                  score: Number(numeric),
                  vector: score.vector,
                },
              ]
            : [];
        }),
        ...(advisory.epss ? { epss: advisory.epss } : {}),
        ...(advisory.kev ? { kev: advisory.kev } : {}),
        requiresDeploymentVerification: true,
        firstSeenAt: saved.firstSeenAt ?? observedAt,
        lastSeenAt: saved.lastSeenAt ?? observedAt,
        correlationKey: advisory.modifiedAt.toISOString(),
      });
    }
    return {
      advisories: current.map(([, advisory]) => advisory),
      reportItems,
      counts,
    };
  }
}
