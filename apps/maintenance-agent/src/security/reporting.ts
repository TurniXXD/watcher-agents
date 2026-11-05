import { createHash } from 'node:crypto';

export type SecurityReportItem = {
  fingerprint: string;
  category: 'CONFIRMED_ENVIRONMENT' | 'TECHNOLOGY_WATCH';
  lifecycle: 'NEW' | 'PERSISTENT' | 'RESURFACED' | 'RESOLVED';
  severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  title: string;
  identifiers: string[];
  subject: string;
  fixedVersions: string[];
  cvss: Array<{
    source: string;
    version: string;
    score: number;
    vector?: string;
  }>;
  epss?: { probability: number; percentile: number; source: 'FIRST' };
  kev?: { listed: boolean; source: 'CISA' };
  newExploitationEvidence?: boolean;
  exposure?: 'INTERNET' | 'INTERNAL' | 'NONE';
  businessCriticality?: 'HIGH' | 'NORMAL' | 'LOW';
  requiresDeploymentVerification?: boolean;
  ageDays?: number;
  firstSeenAt?: Date;
  lastSeenAt?: Date;
  correlationKey?: string;
};

export type SecurityRiskPriority = {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  reasons: string[];
};

export const prioritizeSecurityRisk = (
  finding: SecurityReportItem,
): SecurityRiskPriority => {
  let score = 0;
  const reasons: string[] = [];
  if (finding.category === 'CONFIRMED_ENVIRONMENT') {
    score += 30;
    reasons.push('confirmed deployment impact');
  }
  if (finding.kev?.listed) {
    score += 25;
    reasons.push('listed in CISA KEV');
  }
  if (finding.epss) {
    if (finding.epss.probability >= 0.7) score += 15;
    else if (finding.epss.probability >= 0.2) score += 10;
    else if (finding.epss.probability >= 0.05) score += 5;
    reasons.push(`EPSS ${(finding.epss.probability * 100).toFixed(1)}%`);
  }
  const highestCvss = finding.cvss.reduce(
    (highest, scoreValue) => Math.max(highest, scoreValue.score),
    0,
  );
  if (highestCvss > 0) {
    if (highestCvss >= 9) score += 15;
    else if (highestCvss >= 7) score += 10;
    else if (highestCvss >= 4) score += 5;
    reasons.push(`CVSS ${highestCvss.toFixed(1)}`);
  }
  if (finding.exposure === 'INTERNET') {
    score += 5;
    reasons.push('internet exposed');
  }
  if (finding.businessCriticality === 'HIGH') {
    score += 5;
    reasons.push('high business criticality');
  }
  if (finding.fixedVersions.length > 0) {
    score += 5;
    reasons.push('verified fix available');
  }
  const bounded = Math.min(100, score);
  return {
    score: bounded,
    level:
      bounded >= 80
        ? 'CRITICAL'
        : bounded >= 60
          ? 'HIGH'
          : bounded >= 35
            ? 'MEDIUM'
            : 'LOW',
    reasons,
  };
};

export const immediateSecurityAlert = (
  finding: SecurityReportItem,
  thresholds: { minimumScore: number },
): boolean => {
  if (
    finding.category !== 'CONFIRMED_ENVIRONMENT' ||
    (!['NEW', 'RESURFACED'].includes(finding.lifecycle) &&
      !finding.newExploitationEvidence)
  ) {
    return false;
  }

  return (
    finding.severity === 'CRITICAL' ||
    finding.kev?.listed === true ||
    prioritizeSecurityRisk(finding).score >= thresholds.minimumScore
  );
};

const scoreLine = (item: SecurityReportItem): string => {
  const cvss = item.cvss.length
    ? `CVSS ${Math.max(...item.cvss.map((entry) => entry.score)).toFixed(1)}`
    : 'CVSS unavailable';
  const epss = item.epss
    ? `EPSS ${(item.epss.probability * 100).toFixed(1)}%`
    : 'EPSS unavailable';
  const kev = item.kev?.listed ? 'CISA KEV' : 'not listed in CISA KEV';
  return `${cvss} · ${epss} · ${kev}`;
};

const itemLines = (item: SecurityReportItem): string[] => [
  `${item.severity} · ${item.lifecycle} · ${item.title}`,
  `${item.subject} · ${item.identifiers.join(', ') || 'identifier unavailable'}`,
  scoreLine(item),
  item.fixedVersions.length
    ? `Fix: ${item.fixedVersions.join(', ')}`
    : 'Fix: no verified fixed version reported',
  ...(item.firstSeenAt && item.lastSeenAt
    ? [
        `First seen: ${item.firstSeenAt.toISOString()} · Last seen: ${item.lastSeenAt.toISOString()}`,
      ]
    : []),
];

const canonicalIdentifier = (item: SecurityReportItem): string =>
  item.identifiers.find((identifier) => identifier.startsWith('CVE-')) ??
  item.identifiers.find((identifier) => identifier.startsWith('GHSA-')) ??
  item.identifiers[0] ??
  item.fingerprint;

type SecurityReportGroup = {
  identifier: string;
  representative: SecurityReportItem;
  subjects: string[];
  fixedVersions: string[];
};

const severityRank: Record<SecurityReportItem['severity'], number> = {
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

const lifecycleRank: Record<SecurityReportItem['lifecycle'], number> = {
  RESURFACED: 3,
  NEW: 2,
  PERSISTENT: 1,
  RESOLVED: 0,
};

const compareRisk = (
  left: SecurityReportItem,
  right: SecurityReportItem,
): number => {
  const criticalDifference =
    Number(right.severity === 'CRITICAL') -
    Number(left.severity === 'CRITICAL');
  if (criticalDifference !== 0) return criticalDifference;
  const kevDifference =
    Number(right.kev?.listed === true) - Number(left.kev?.listed === true);
  if (kevDifference !== 0) return kevDifference;
  const severityDifference =
    severityRank[right.severity] - severityRank[left.severity];
  if (severityDifference !== 0) return severityDifference;
  const scoreDifference =
    prioritizeSecurityRisk(right).score - prioritizeSecurityRisk(left).score;
  if (scoreDifference !== 0) return scoreDifference;
  return lifecycleRank[right.lifecycle] - lifecycleRank[left.lifecycle];
};

const mergeGroupRepresentative = (
  current: SecurityReportItem,
  next: SecurityReportItem,
): SecurityReportItem => ({
  ...current,
  severity:
    severityRank[next.severity] > severityRank[current.severity]
      ? next.severity
      : current.severity,
  identifiers: [...new Set([...current.identifiers, ...next.identifiers])],
  fixedVersions: [
    ...new Set([...current.fixedVersions, ...next.fixedVersions]),
  ],
  cvss: [...current.cvss, ...next.cvss],
  ...((next.epss?.probability ?? -1) > (current.epss?.probability ?? -1)
    ? { epss: next.epss }
    : {}),
  ...(current.kev?.listed || next.kev?.listed
    ? { kev: { listed: true, source: 'CISA' } }
    : {}),
  ...(current.newExploitationEvidence || next.newExploitationEvidence
    ? { newExploitationEvidence: true }
    : {}),
  ...(current.firstSeenAt || next.firstSeenAt
    ? {
        firstSeenAt:
          !current.firstSeenAt ||
          (next.firstSeenAt && next.firstSeenAt < current.firstSeenAt)
            ? next.firstSeenAt
            : current.firstSeenAt,
      }
    : {}),
  ...(current.lastSeenAt || next.lastSeenAt
    ? {
        lastSeenAt:
          !current.lastSeenAt ||
          (next.lastSeenAt && next.lastSeenAt > current.lastSeenAt)
            ? next.lastSeenAt
            : current.lastSeenAt,
      }
    : {}),
});

const groupByVulnerability = (
  items: readonly SecurityReportItem[],
): SecurityReportGroup[] => {
  const groups = new Map<string, SecurityReportGroup>();
  for (const item of riskOrdered(items)) {
    const identifier = canonicalIdentifier(item);
    const prior = groups.get(identifier);
    if (!prior) {
      groups.set(identifier, {
        identifier,
        representative: item,
        subjects: [item.subject],
        fixedVersions: [...item.fixedVersions],
      });
      continue;
    }
    prior.representative = mergeGroupRepresentative(prior.representative, item);
    prior.subjects = [...new Set([...prior.subjects, item.subject])];
    prior.fixedVersions = [
      ...new Set([...prior.fixedVersions, ...item.fixedVersions]),
    ];
  }
  return [...groups.values()].sort((left, right) =>
    compareRisk(left.representative, right.representative),
  );
};

const compactGroupLines = (group: SecurityReportGroup): string[] => {
  const visibleSubjects = group.subjects.slice(0, 6);
  const hiddenSubjects = group.subjects.length - visibleSubjects.length;
  const affected = `${visibleSubjects.join('; ')}${hiddenSubjects ? `; +${hiddenSubjects} more` : ''}`;
  return [
    `${group.identifier} · ${group.representative.severity} · ${scoreLine(group.representative)}`,
    group.representative.title,
    `Affected: ${affected}`,
    group.fixedVersions.length
      ? `Fix: ${group.fixedVersions.slice(0, 4).join(', ')}`
      : 'Fix: no verified fixed version reported',
    ...(group.representative.firstSeenAt && group.representative.lastSeenAt
      ? [
          `First seen: ${group.representative.firstSeenAt.toISOString()} · Last seen: ${group.representative.lastSeenAt.toISOString()}`,
        ]
      : []),
  ];
};

const bounded = (
  value: string,
  maxLength: number,
  truncationNotice = 'Additional report content omitted to keep this to one message.',
): string => {
  if (value.length <= maxLength) return value;
  const suffix = `\n\n${truncationNotice}`;
  const prefixLength = Math.max(0, maxLength - suffix.length);
  return `${value.slice(0, prefixLength).trimEnd()}${suffix}`.slice(
    0,
    maxLength,
  );
};

const riskOrdered = (
  items: readonly SecurityReportItem[],
): SecurityReportItem[] => [...items].sort(compareRisk);

export const renderDailySecurityDigest = (
  items: readonly SecurityReportItem[],
  options: { generatedAt: Date; maxLength: number },
): string => {
  const confirmed = riskOrdered(
    items.filter(
      (item) =>
        item.category === 'CONFIRMED_ENVIRONMENT' &&
        item.lifecycle !== 'RESOLVED',
    ),
  );
  const confirmedGroups = groupByVulnerability(confirmed);
  const advisories = riskOrdered(
    items.filter(
      (item) =>
        item.category === 'TECHNOLOGY_WATCH' && item.lifecycle !== 'RESOLVED',
    ),
  );
  const lines = [
    '🛡 Daily security digest',
    options.generatedAt.toISOString(),
    '',
    'Confirmed environment findings',
    ...(confirmedGroups.length
      ? confirmedGroups.flatMap((group) => [...compactGroupLines(group), ''])
      : ['No new or unresolved confirmed findings.', '']),
    'Technology watch — verification required',
    ...(advisories.length
      ? advisories.flatMap((item) => [...itemLines(item), ''])
      : ['No relevant technology-watch advisories.', '']),
    'Technology-watch entries are not confirmed deployment vulnerabilities until installed-version evidence is verified.',
  ];
  return bounded(lines.join('\n').trim(), options.maxLength);
};

export const renderCriticalSecurityDigest = (
  items: readonly SecurityReportItem[],
  maxLength = 4_096,
): string => {
  const groups = groupByVulnerability(items);
  const noun =
    groups.length === 1 && groups[0]?.identifier.startsWith('CVE-')
      ? 'CVE'
      : groups.every((group) => group.identifier.startsWith('CVE-'))
        ? 'CVEs'
        : groups.length === 1
          ? 'finding'
          : 'findings';
  const header = `🚨 Security scan: ${groups.length} urgent ${noun}`;
  const footer = 'No update or restart was applied automatically.';
  const blocks = groups.map(compactGroupLines);
  const compose = (visible: readonly string[][], omitted: number): string =>
    [
      header,
      '',
      ...visible.flatMap((block) => [...block, '']),
      ...(omitted > 0
        ? [
            `Additional ${omitted} urgent findings omitted to keep this to one message.`,
            '',
          ]
        : []),
      footer,
    ]
      .join('\n')
      .trim();
  const visible: string[][] = [];
  for (const block of blocks) {
    const candidate = [...visible, block];
    if (compose(candidate, blocks.length - candidate.length).length > maxLength)
      break;
    visible.push(block);
  }
  const report = compose(visible, blocks.length - visible.length);
  return report.length <= maxLength
    ? report
    : bounded(
        report,
        maxLength,
        'Additional urgent findings omitted.\nNo update or restart was applied automatically.',
      );
};

export const securityAlertBatchDeduplicationKey = (
  batchIdentity: string,
  chatId: number,
): string => {
  const digest = createHash('sha256').update(batchIdentity).digest('hex');
  return `security-alert:${digest}:${chatId}`;
};

export const renderWeeklySecurityReport = (
  items: readonly SecurityReportItem[],
  options: { generatedAt: Date; maxLength: number },
): string => {
  const count = (lifecycle: SecurityReportItem['lifecycle']) =>
    items.filter((item) => item.lifecycle === lifecycle).length;
  const unresolvedAges = items.flatMap((item) =>
    item.lifecycle !== 'RESOLVED' && item.ageDays !== undefined
      ? [item.ageDays]
      : [],
  );
  const bySeverity = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']
    .map(
      (severity) =>
        `${severity} ${items.filter((item) => item.severity === severity && item.lifecycle !== 'RESOLVED').length}`,
    )
    .join(' · ');
  return bounded(
    [
      '🛡 Weekly security and maintenance report',
      options.generatedAt.toISOString(),
      '',
      `New ${count('NEW')} · Resolved ${count('RESOLVED')} · Resurfaced ${count('RESURFACED')}`,
      bySeverity,
      `Oldest unresolved: ${unresolvedAges.length ? `${Math.max(...unresolvedAges)} days` : 'age unavailable'}`,
      `Verified fixes available: ${items.filter((item) => item.lifecycle !== 'RESOLVED' && item.fixedVersions.length > 0).length}`,
      '',
      'Technology-watch entries require deployed-version verification and are not counted as confirmed environment impact.',
    ].join('\n'),
    options.maxLength,
  );
};
