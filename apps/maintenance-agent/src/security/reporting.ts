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

const bounded = (value: string, maxLength: number): string =>
  splitTelegramMessage(value, maxLength)[0] ?? '';

const riskOrdered = (
  items: readonly SecurityReportItem[],
): SecurityReportItem[] =>
  [...items].sort((left, right) => {
    const scoreDifference =
      prioritizeSecurityRisk(right).score - prioritizeSecurityRisk(left).score;
    if (scoreDifference !== 0) return scoreDifference;
    const lifecycleRank = { RESURFACED: 3, NEW: 2, PERSISTENT: 1, RESOLVED: 0 };
    return lifecycleRank[right.lifecycle] - lifecycleRank[left.lifecycle];
  });

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
    ...(confirmed.length
      ? confirmed.flatMap((item) => [...itemLines(item), ''])
      : ['No new or unresolved confirmed findings.', '']),
    'Technology watch — verification required',
    ...(advisories.length
      ? advisories.flatMap((item) => [...itemLines(item), ''])
      : ['No relevant technology-watch advisories.', '']),
    'Technology-watch entries are not confirmed deployment vulnerabilities until installed-version evidence is verified.',
  ];
  return bounded(lines.join('\n').trim(), options.maxLength);
};

export const renderCriticalSecurityAlert = (
  item: SecurityReportItem,
  maxLength = 4_096,
): string =>
  bounded(
    [
      '🚨 Confirmed security alert',
      '',
      ...itemLines(item),
      '',
      `Priority: ${prioritizeSecurityRisk(item).score}/100 — ${prioritizeSecurityRisk(item).reasons.join(', ')}`,
      'No update or restart was applied automatically.',
    ].join('\n'),
    maxLength,
  );

export const securityAlertDeduplicationKey = (
  item: SecurityReportItem,
  chatId: number,
): string =>
  `security-alert:${item.fingerprint}:${item.lifecycle}:${item.correlationKey ?? 'unknown'}:${chatId}`;

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
import { splitTelegramMessage } from '@watcher/telegram';
