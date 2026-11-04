import { describe, expect, it } from 'vitest';
import {
  immediateSecurityAlert,
  prioritizeSecurityRisk,
  renderDailySecurityDigest,
  renderWeeklySecurityReport,
  securityAlertDeduplicationKey,
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

  it('deduplicates unchanged alerts while allowing a later resurfaced alert', () => {
    const first = securityAlertDeduplicationKey(confirmed, 123);
    expect(securityAlertDeduplicationKey(confirmed, 123)).toBe(first);
    expect(
      securityAlertDeduplicationKey(
        { ...confirmed, lifecycle: 'RESURFACED' },
        123,
      ),
    ).not.toBe(first);
  });
});
