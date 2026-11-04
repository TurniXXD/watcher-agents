import { describe, expect, it } from 'vitest';
import { normalizeTrivyReport, parseTrivyReport } from '../security/trivy.js';

const fixture = {
  SchemaVersion: 2,
  CreatedAt: '2026-11-04T09:00:00Z',
  ArtifactName: 'ghcr.io/acme/watcher@sha256:abc',
  ArtifactType: 'container_image',
  Metadata: {
    ImageID: 'sha256:image',
    RepoDigests: ['ghcr.io/acme/watcher@sha256:abc'],
  },
  Results: [
    {
      Target: 'watcher (alpine 3.22)',
      Class: 'os-pkgs',
      Type: 'alpine',
      Vulnerabilities: [
        {
          VulnerabilityID: 'CVE-2026-1000',
          PkgName: 'libssl3',
          PkgIdentifier: { PURL: 'pkg:apk/alpine/libssl3@3.5.0-r0' },
          InstalledVersion: '3.5.0-r0',
          FixedVersion: '3.5.1-r0',
          Status: 'fixed',
          Severity: 'CRITICAL',
          SeveritySource: 'nvd',
          PrimaryURL: 'https://avd.aquasec.com/nvd/cve-2026-1000',
          References: ['https://nvd.nist.gov/vuln/detail/CVE-2026-1000'],
          CVSS: {
            nvd: {
              V3Score: 9.8,
              V3Vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
            },
            redhat: { V3Score: 8.1 },
          },
        },
      ],
    },
    ...['npm', 'gomod', 'cargo'].map((type, index) => ({
      Target: type === 'npm' ? 'pnpm-lock.yaml' : `${type}.lock`,
      Class: 'lang-pkgs',
      Type: type,
      Vulnerabilities: [
        {
          VulnerabilityID: `GHSA-test-${index}`,
          PkgName: `${type}-package`,
          InstalledVersion: '1.0.0',
          Severity: 'HIGH',
          References: [`https://example.test/${type}`],
        },
      ],
    })),
    {
      Target: 'Dockerfile',
      Class: 'config',
      Type: 'dockerfile',
      Misconfigurations: [
        {
          ID: 'DS002',
          AVDID: 'AVD-DS-0002',
          Type: 'Dockerfile Security Check',
          Title: 'Image user should not be root',
          Description: 'A USER instruction is required.',
          Message: 'Specify a non-root USER.',
          Namespace: 'builtin.dockerfile.DS002',
          Query: 'data.builtin.dockerfile.DS002.deny',
          Resolution: 'Add USER 10001.',
          Severity: 'HIGH',
          PrimaryURL: 'https://avd.aquasec.com/misconfig/ds002',
          Status: 'FAIL',
          CauseMetadata: { StartLine: 1, EndLine: 4 },
        },
      ],
    },
  ],
};

describe('Trivy security report normalization', () => {
  it('normalizes Linux, npm, Go, Rust, and misconfiguration evidence', () => {
    const report = parseTrivyReport(fixture);
    const findings = normalizeTrivyReport(report, {
      project: 'watcher',
      service: 'production-image',
      scanKey: 'sha256:abc',
      scannedAt: new Date('2026-11-04T09:00:00Z'),
    });

    expect(findings).toHaveLength(5);
    expect(findings.map((finding) => finding.ecosystem)).toEqual([
      'alpine',
      'npm',
      'gomod',
      'cargo',
      'dockerfile',
    ]);
    expect(findings[0]).toMatchObject({
      category: 'CONFIRMED_ENVIRONMENT',
      kind: 'VULNERABILITY',
      component: 'libssl3',
      installedVersion: '3.5.0-r0',
      fixedVersion: '3.5.1-r0',
      identifiers: ['CVE-2026-1000'],
      severity: 'CRITICAL',
      cvss: [
        {
          source: 'nvd',
          version: '3.1',
          score: 9.8,
          vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
        },
        { source: 'redhat', version: '3.x', score: 8.1 },
      ],
    });
    expect(findings[4]).toMatchObject({
      kind: 'MISCONFIGURATION',
      identifiers: ['AVD-DS-0002'],
      component: 'Dockerfile',
      recommendation: 'Add USER 10001.',
    });
    expect(findings[4]).not.toHaveProperty('fixedVersion');
  });

  it('keeps absent scores absent instead of inventing zero values', () => {
    const findings = normalizeTrivyReport(parseTrivyReport(fixture), {
      project: 'watcher',
      service: 'production-image',
      scanKey: 'sha256:abc',
      scannedAt: new Date('2026-11-04T09:00:00Z'),
    });

    expect(findings[1]?.cvss).toEqual([]);
    expect(findings[1]).not.toHaveProperty('epss');
  });

  it('uses package and target identity so duplicates are stable but distinct packages do not collapse', () => {
    const report = parseTrivyReport({
      ...fixture,
      Results: [
        {
          Target: 'pnpm-lock.yaml',
          Class: 'lang-pkgs',
          Type: 'npm',
          Vulnerabilities: [
            {
              VulnerabilityID: 'GHSA-aaaa-bbbb-cccc',
              PkgName: 'alpha',
              InstalledVersion: '1.0.0',
              Severity: 'HIGH',
            },
            {
              VulnerabilityID: 'GHSA-aaaa-bbbb-cccc',
              PkgName: 'beta',
              InstalledVersion: '1.0.0',
              Severity: 'HIGH',
            },
          ],
        },
      ],
    });
    const context = {
      project: 'watcher',
      service: 'dependencies',
      scanKey: 'lock-hash',
      scannedAt: new Date('2026-11-04T09:00:00Z'),
    };

    const first = normalizeTrivyReport(report, context);
    const second = normalizeTrivyReport(report, context);
    expect(first[0]?.fingerprint).toBe(second[0]?.fingerprint);
    expect(first[0]?.fingerprint).not.toBe(first[1]?.fingerprint);
  });

  it('uses a canonical CVE alias for lifecycle identity when scanner identifiers differ', () => {
    const result = (id: string, vendorIds: string[]) => ({
      ...fixture,
      Results: [
        {
          Target: 'pnpm-lock.yaml',
          Type: 'npm',
          Vulnerabilities: [
            {
              VulnerabilityID: id,
              VendorIDs: vendorIds,
              PkgName: 'example',
              InstalledVersion: '1.0.0',
              Severity: 'HIGH',
            },
          ],
        },
      ],
    });
    const context = {
      project: 'watcher',
      service: 'dependencies',
      scanKey: 'lock-hash',
      scannedAt: new Date('2026-11-04T09:00:00Z'),
    };

    const ghsa = normalizeTrivyReport(
      parseTrivyReport(result('GHSA-aaaa-bbbb-cccc', ['CVE-2026-1234'])),
      context,
    );
    const cve = normalizeTrivyReport(
      parseTrivyReport(result('CVE-2026-1234', ['GHSA-aaaa-bbbb-cccc'])),
      context,
    );
    const combinedReport = result('GHSA-aaaa-bbbb-cccc', ['CVE-2026-1234']);
    combinedReport.Results[0]!.Vulnerabilities.push({
      VulnerabilityID: 'CVE-2026-1234',
      VendorIDs: ['GHSA-aaaa-bbbb-cccc'],
      PkgName: 'example',
      InstalledVersion: '1.0.0',
      Severity: 'HIGH',
    });
    const combined = normalizeTrivyReport(
      parseTrivyReport(combinedReport),
      context,
    );

    expect(ghsa[0]?.fingerprint).toBe(cve[0]?.fingerprint);
    expect(combined).toHaveLength(1);
    expect(combined[0]?.identifiers).toEqual([
      'GHSA-aaaa-bbbb-cccc',
      'CVE-2026-1234',
    ]);
  });

  it('keeps lifecycle identity stable when an immutable image digest changes', () => {
    const context = {
      project: 'watcher',
      service: 'production-image',
      scanKey: 'sha256:first',
      scannedAt: new Date('2026-11-04T09:00:00Z'),
    };
    const first = normalizeTrivyReport(
      parseTrivyReport({
        ...fixture,
        Results: [
          {
            ...fixture.Results[0],
            Target: 'ghcr.io/acme/watcher@sha256:first (alpine 3.22)',
          },
        ],
      }),
      context,
    );
    const second = normalizeTrivyReport(
      parseTrivyReport({
        ...fixture,
        Results: [
          {
            ...fixture.Results[0],
            Target: 'ghcr.io/acme/watcher@sha256:second (alpine 3.22)',
          },
        ],
      }),
      { ...context, scanKey: 'sha256:second' },
    );

    expect(first[0]?.fingerprint).toBe(second[0]?.fingerprint);
  });

  it('rejects malformed scanner output at the boundary', () => {
    expect(() =>
      parseTrivyReport({ SchemaVersion: 2, Results: [{ Target: 42 }] }),
    ).toThrow();
  });
});
