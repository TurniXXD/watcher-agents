import { describe, expect, it } from 'vitest';
import {
  immediateSecurityAlert,
  prioritizeSecurityRisk,
  renderCriticalSecurityDigest,
  renderDailySecurityDigest,
  renderWeeklySecurityReport,
  securityAlertBatchDeduplicationKey,
  type SecurityReportItem,
} from '../security/reporting.js';

const confirmed: SecurityReportItem = {
  fingerprint: 'confirmed-1',
  category: 'CONFIRMED_ENVIRONMENT',
  lifecycle: 'NEW',
  severity: 'CRITICAL',
  title: 'Critical OpenSSL vulnerability',
  identifiers: ['CVE-2026-1000'],
  subject: 'libssl3 3.5.0-r0',
  fixedVersions: ['3.5.1-r0'],
  cvss: [{ source: 'nvd', version: '3.1', score: 9.8 }],
  epss: { probability: 0.91, percentile: 0.999, source: 'FIRST' },
  kev: { listed: true, source: 'CISA' },
  exposure: 'INTERNET',
  businessCriticality: 'HIGH',
  firstSeenAt: new Date('2026-11-01T10:00:00Z'),
  lastSeenAt: new Date('2026-11-04T10:00:00Z'),
};

const advisory: SecurityReportItem = {
  fingerprint: 'advisory-1',
  category: 'TECHNOLOGY_WATCH',
  lifecycle: 'NEW',
  severity: 'HIGH',
  title: 'Next.js advisory',
  identifiers: ['GHSA-aaaa-bbbb-cccc'],
  subject: 'Vercel Next.js',
  fixedVersions: [],
  cvss: [],
  requiresDeploymentVerification: true,
};

describe('security reporting and alert policy', () => {
  it('prioritizes confirmed impact, exploitation, EPSS, CVSS, exposure, criticality, and fixes', () => {
    expect(prioritizeSecurityRisk(confirmed)).toEqual({
      score: 100,
      level: 'CRITICAL',
      reasons: [
        'confirmed deployment impact',
        'listed in CISA KEV',
        'EPSS 91.0%',
        'CVSS 9.8',
        'internet exposed',
        'high business criticality',
        'verified fix available',
      ],
    });
  });

  it('alerts immediately only for new or resurfaced confirmed high-risk findings', () => {
    const sparseConfirmed: SecurityReportItem = {
      fingerprint: confirmed.fingerprint,
      category: confirmed.category,
      lifecycle: confirmed.lifecycle,
      severity: confirmed.severity,
      title: confirmed.title,
      identifiers: confirmed.identifiers,
      subject: confirmed.subject,
      fixedVersions: [],
      cvss: [],
    };
    expect(immediateSecurityAlert(confirmed, { minimumScore: 80 })).toBe(true);
    expect(
      immediateSecurityAlert(
        { ...confirmed, lifecycle: 'PERSISTENT' },
        { minimumScore: 80 },
      ),
    ).toBe(false);
    expect(
      immediateSecurityAlert(
        {
          ...confirmed,
          lifecycle: 'PERSISTENT',
          newExploitationEvidence: true,
        },
        { minimumScore: 100 },
      ),
    ).toBe(true);
    expect(
      immediateSecurityAlert(
        { ...advisory, kev: { listed: true, source: 'CISA' } },
        { minimumScore: 1 },
      ),
    ).toBe(false);
    expect(
      immediateSecurityAlert(
        {
          ...sparseConfirmed,
          severity: 'HIGH',
          cvss: [],
          kev: { listed: true, source: 'CISA' },
          fixedVersions: [],
        },
        { minimumScore: 100 },
      ),
    ).toBe(true);
    expect(
      immediateSecurityAlert(
        {
          ...sparseConfirmed,
          cvss: [],
          fixedVersions: [],
        },
        { minimumScore: 100 },
      ),
    ).toBe(true);
    expect(
      immediateSecurityAlert(
        {
          ...sparseConfirmed,
          severity: 'HIGH',
          cvss: [{ source: 'nvd', version: '3.1', score: 8.8 }],
          epss: { probability: 0.9, percentile: 0.99, source: 'FIRST' },
          exposure: 'INTERNET',
          businessCriticality: 'HIGH',
          fixedVersions: ['1.1.0'],
        },
        { minimumScore: 70 },
      ),
    ).toBe(true);
  });

  it('renders confirmed findings separately from verification-required advisories', () => {
    const digest = renderDailySecurityDigest([confirmed, advisory], {
      generatedAt: new Date('2026-11-04T12:00:00Z'),
      maxLength: 4_096,
    });

    expect(digest).toContain('Confirmed environment findings');
    expect(digest).toContain('Technology watch — verification required');
    expect(digest).toContain('EPSS 91.0%');
    expect(digest).toContain('First seen: 2026-11-01T10:00:00.000Z');
    expect(digest).toContain('EPSS unavailable');
    expect(digest).not.toContain('EPSS 0%');
    expect(digest.length).toBeLessThanOrEqual(4_096);
  });

  it('groups duplicate package findings into one CVE-centric immediate report', () => {
    const digest = renderCriticalSecurityDigest([
      confirmed,
      {
        ...confirmed,
        fingerprint: 'confirmed-2',
        subject: 'openssl 3.5.0-r0',
      },
    ]);

    expect(digest).toContain('1 urgent CVE');
    expect(digest.match(/CVE-2026-1000/gu)).toHaveLength(1);
    expect(digest).toContain('Affected: libssl3 3.5.0-r0; openssl 3.5.0-r0');
    expect(digest.length).toBeLessThanOrEqual(4_096);
  });

  it('uses the worst evidence found across every package in a CVE group', () => {
    const digest = renderCriticalSecurityDigest([
      {
        ...confirmed,
        severity: 'HIGH',
        cvss: [{ source: 'vendor', version: '3.1', score: 7.5 }],
      },
      {
        fingerprint: 'confirmed-2',
        category: 'CONFIRMED_ENVIRONMENT',
        lifecycle: 'NEW',
        severity: 'CRITICAL',
        title: confirmed.title,
        identifiers: confirmed.identifiers,
        subject: 'openssl 3.5.0-r0',
        fixedVersions: [],
        cvss: [{ source: 'nvd', version: '3.1', score: 9.8 }],
      },
    ]);

    expect(digest).toContain('CVE-2026-1000 · CRITICAL · CVSS 9.8');
    expect(digest).toContain('EPSS 91.0% · CISA KEV');
  });

  it('marks omitted urgent findings instead of silently truncating a scan', () => {
    const digest = renderCriticalSecurityDigest(
      Array.from({ length: 12 }, (_, index) => ({
        ...confirmed,
        fingerprint: `confirmed-${index}`,
        identifiers: [`CVE-2026-${1000 + index}`],
        title: `Critical vulnerability ${index} ${'x'.repeat(120)}`,
        subject: `package-${index} 1.0.0`,
      })),
      700,
    );

    expect(digest).toMatch(/Additional \d+ urgent findings omitted/u);
    expect(digest).toContain('No update or restart was applied automatically.');
    expect(digest.match(/^CVE-/gmu)).toHaveLength(
      digest.match(/^Fix: .+$/gmu)?.length ?? 0,
    );
    expect(digest.length).toBeLessThanOrEqual(700);
  });

  it('keeps sparse critical CVEs ahead of scored high findings when compacting', () => {
    const sparseCritical: SecurityReportItem = {
      fingerprint: 'sparse-critical',
      category: 'CONFIRMED_ENVIRONMENT',
      lifecycle: 'NEW',
      severity: 'CRITICAL',
      title: 'Sparse critical finding',
      identifiers: ['CVE-2026-9999'],
      subject: 'critical-package 1.0.0',
      fixedVersions: [],
      cvss: [],
    };
    const digest = renderCriticalSecurityDigest(
      [
        ...Array.from({ length: 8 }, (_, index): SecurityReportItem => ({
          fingerprint: `high-${index}`,
          category: 'CONFIRMED_ENVIRONMENT',
          lifecycle: 'NEW',
          severity: 'HIGH',
          identifiers: [`CVE-2026-${2000 + index}`],
          title: `High scored finding ${index} ${'x'.repeat(120)}`,
          subject: `high-package-${index} 1.0.0`,
          fixedVersions: ['1.1.0'],
          cvss: [{ source: 'nvd', version: '3.1', score: 8.8 }],
          epss: { probability: 0.9, percentile: 0.99, source: 'FIRST' },
          exposure: 'INTERNET',
          businessCriticality: 'HIGH',
        })),
        sparseCritical,
      ],
      700,
    );

    expect(digest).toContain('CVE-2026-9999 · CRITICAL');
    expect(digest).toMatch(/Additional \d+ urgent findings omitted/u);
  });

  it('groups duplicate package findings in the daily CVE report', () => {
    const digest = renderDailySecurityDigest(
      [
        confirmed,
        {
          ...confirmed,
          fingerprint: 'confirmed-2',
          subject: 'openssl 3.5.0-r0',
        },
      ],
      { generatedAt: new Date('2026-11-04T12:00:00Z'), maxLength: 4_096 },
    );

    expect(digest.match(/CVE-2026-1000/gu)).toHaveLength(1);
    expect(digest).toContain('Affected: libssl3 3.5.0-r0; openssl 3.5.0-r0');
  });

  it('keeps the highest-risk unresolved finding first when a digest is bounded', () => {
    const digest = renderDailySecurityDigest(
      [
        ...Array.from({ length: 10 }, (_, index) => ({
          ...advisory,
          fingerprint: `low-${index}`,
          title: `Low advisory ${index} ${'x'.repeat(100)}`,
          severity: 'LOW' as const,
        })),
        confirmed,
      ],
      { generatedAt: new Date('2026-11-04T12:00:00Z'), maxLength: 500 },
    );

    expect(digest).toContain('Critical OpenSSL vulnerability');
  });

  it('renders weekly lifecycle trends and aging without claiming advisories are deployed', () => {
    const report = renderWeeklySecurityReport(
      [
        confirmed,
        advisory,
        {
          ...confirmed,
          fingerprint: 'resolved',
          lifecycle: 'RESOLVED',
          ageDays: 12,
        },
      ],
      { generatedAt: new Date('2026-11-04T12:00:00Z'), maxLength: 4_096 },
    );

    expect(report).toContain('New 2 · Resolved 1 · Resurfaced 0');
    expect(report).toContain('Oldest unresolved');
    expect(report).toContain(
      'Technology-watch entries require deployed-version verification',
    );
  });

  it('deduplicates one alert batch per scan while allowing a later scan', () => {
    const first = securityAlertBatchDeduplicationKey(
      '["watcher","production-image","scan-1"]',
      123,
    );
    expect(
      securityAlertBatchDeduplicationKey(
        '["watcher","production-image","scan-1"]',
        123,
      ),
    ).toBe(first);
    expect(
      securityAlertBatchDeduplicationKey(
        '["watcher","production-image","scan-2"]',
        123,
      ),
    ).not.toBe(first);
    expect(
      securityAlertBatchDeduplicationKey(
        '["watcher","dependencies","scan-1"]',
        123,
      ),
    ).not.toBe(first);
  });
});
