import { describe, expect, it, vi } from 'vitest';
import type { FindingInput } from '@watcher/database';
import type { SecurityReportItem } from '../security/reporting.js';
import { SecurityIntelligenceService } from '../security/service.js';

const report = (vulnerabilities: Array<Record<string, unknown>>) => ({
  SchemaVersion: 2,
  ArtifactName: 'watcher',
  ArtifactType: 'filesystem',
  Results: [
    {
      Target: 'pnpm-lock.yaml',
      Class: 'lang-pkgs',
      Type: 'npm',
      Vulnerabilities: vulnerabilities,
    },
  ],
});

const vulnerability = (id: string, packageName: string) => ({
  VulnerabilityID: id,
  PkgName: packageName,
  InstalledVersion: '1.0.0',
  FixedVersion: '1.1.0',
  Severity: 'HIGH',
});

describe('SecurityIntelligenceService', () => {
  it('tracks new, persistent, resurfaced, and scoped resolved findings', async () => {
    const existing = [
      {
        id: 'persistent-id',
        fingerprint: 'replaced-below',
        status: 'OPEN' as const,
        evidence: { securityScope: 'watcher:dependencies' },
      },
      {
        id: 'resurfaced-id',
        fingerprint: 'replaced-below',
        status: 'RESOLVED' as const,
        evidence: { securityScope: 'watcher:dependencies' },
      },
      {
        id: 'resolved-id',
        fingerprint: 'absent-fingerprint',
        status: 'OPEN' as const,
        evidence: { securityScope: 'watcher:dependencies' },
      },
      {
        id: 'other-scope',
        fingerprint: 'other-fingerprint',
        status: 'OPEN' as const,
        evidence: { securityScope: 'watcher:production-image' },
      },
    ];
    const upsertFinding = vi.fn(async (input: FindingInput) => ({
      id: input.fingerprint,
    }));
    const resolveFindings = vi.fn(async () => ({ count: 1 }));
    const upsertRecommendation = vi.fn(async () => ({}));
    const store = {
      listSecurityFindings: vi.fn(async () => existing),
      upsertFinding,
      resolveFindings,
      upsertRecommendation,
    };
    const service = new SecurityIntelligenceService(store);
    const firstPass = service.previewTrivy(
      report([
        vulnerability('CVE-2026-1', 'persistent-package'),
        vulnerability('CVE-2026-2', 'resurfaced-package'),
        vulnerability('CVE-2026-3', 'new-package'),
      ]),
      {
        project: 'watcher',
        service: 'dependencies',
        scanKey: 'lock-hash',
        scannedAt: new Date('2026-11-04T10:00:00Z'),
      },
    );
    existing[0]!.fingerprint = firstPass[0]!.fingerprint;
    existing[1]!.fingerprint = firstPass[1]!.fingerprint;

    const result = await service.ingestTrivy(
      report([
        vulnerability('CVE-2026-1', 'persistent-package'),
        vulnerability('CVE-2026-2', 'resurfaced-package'),
        vulnerability('CVE-2026-3', 'new-package'),
      ]),
      {
        project: 'watcher',
        service: 'dependencies',
        scanKey: 'lock-hash',
        scannedAt: new Date('2026-11-04T10:00:00Z'),
      },
    );

    expect(result.counts).toEqual({
      new: 1,
      persistent: 1,
      resurfaced: 1,
      resolved: 1,
    });
    expect(resolveFindings).toHaveBeenCalledWith(['absent-fingerprint']);
    expect(
      upsertFinding.mock.calls.map(([input]) => input.evidence.lifecycle),
    ).toEqual(['PERSISTENT', 'RESURFACED', 'NEW']);
    expect(upsertRecommendation).toHaveBeenCalledTimes(3);
  });

  it('resolves prior findings when a valid report for that scope is empty', async () => {
    const store = {
      listSecurityFindings: vi.fn(async () => [
        {
          id: 'finding-id',
          fingerprint: 'old-fingerprint',
          status: 'OPEN' as const,
          evidence: { securityScope: 'watcher:dependencies' },
        },
      ]),
      upsertFinding: vi.fn(),
      resolveFindings: vi.fn(async () => ({ count: 1 })),
      upsertRecommendation: vi.fn(),
    };
    const service = new SecurityIntelligenceService(store);

    const result = await service.ingestTrivy(report([]), {
      project: 'watcher',
      service: 'dependencies',
      scanKey: 'new-lock-hash',
      scannedAt: new Date('2026-11-04T10:00:00Z'),
    });

    expect(result.counts.resolved).toBe(1);
    expect(store.resolveFindings).toHaveBeenCalledWith(['old-fingerprint']);
    expect(store.upsertFinding).not.toHaveBeenCalled();
  });

  it('rejects malformed reports without mutating persistence', async () => {
    const store = {
      listSecurityFindings: vi.fn(),
      upsertFinding: vi.fn(),
      resolveFindings: vi.fn(),
      upsertRecommendation: vi.fn(),
    };
    const service = new SecurityIntelligenceService(store);

    await expect(
      service.ingestTrivy(
        { SchemaVersion: 1 },
        {
          project: 'watcher',
          service: 'dependencies',
          scanKey: 'bad',
          scannedAt: new Date('2026-11-04T10:00:00Z'),
        },
      ),
    ).rejects.toThrow();
    expect(store.listSecurityFindings).not.toHaveBeenCalled();
  });

  it('keeps a new critical finding retriable when durable alert enqueue fails', async () => {
    const store = {
      listSecurityFindings: vi.fn(async () => []),
      upsertFinding: vi.fn(),
      resolveFindings: vi.fn(async () => ({ count: 0 })),
      upsertRecommendation: vi.fn(),
    };
    const service = new SecurityIntelligenceService(store, {
      onImmediateAlerts: vi.fn(async () => {
        throw new Error('outbox unavailable');
      }),
    });

    await expect(
      service.ingestTrivy(
        report([
          { ...vulnerability('CVE-2026-9', 'critical'), Severity: 'CRITICAL' },
        ]),
        {
          project: 'watcher',
          service: 'dependencies',
          scanKey: 'critical-lock-hash',
          scannedAt: new Date('2026-11-04T10:00:00Z'),
        },
      ),
    ).rejects.toThrow('outbox unavailable');
    expect(store.upsertFinding).not.toHaveBeenCalled();
    expect(store.upsertRecommendation).not.toHaveBeenCalled();
  });

  it('emits one immediate alert batch for all urgent findings in a scan', async () => {
    const onImmediateAlerts = vi.fn<
      (
        items: readonly SecurityReportItem[],
        batchIdentity: string,
      ) => Promise<void>
    >(async () => undefined);
    const store = {
      listSecurityFindings: vi.fn(async () => []),
      upsertFinding: vi.fn(async (input: FindingInput) => ({
        id: input.fingerprint,
      })),
      resolveFindings: vi.fn(async () => ({ count: 0 })),
      upsertRecommendation: vi.fn(async () => ({})),
    };
    const service = new SecurityIntelligenceService(store, {
      onImmediateAlerts,
    });

    await service.ingestTrivy(
      report([
        { ...vulnerability('CVE-2026-9', 'perl'), Severity: 'CRITICAL' },
        { ...vulnerability('CVE-2026-9', 'perl-base'), Severity: 'CRITICAL' },
      ]),
      {
        project: 'watcher',
        service: 'production-image',
        scanKey: 'sha256:image',
        scannedAt: new Date('2026-11-04T10:00:00Z'),
      },
    );

    expect(onImmediateAlerts).toHaveBeenCalledOnce();
    expect(onImmediateAlerts.mock.calls[0]?.[0]).toHaveLength(2);
    expect(onImmediateAlerts.mock.calls[0]?.[1]).toBe(
      '["watcher","production-image","sha256:image"]',
    );
  });

  it('persists watch advisories as verification-required rather than confirmed findings', async () => {
    const upsertFinding = vi.fn(async (input: FindingInput) => ({
      id: input.fingerprint,
    }));
    const store = {
      listSecurityFindings: vi.fn(async () => []),
      upsertFinding,
      resolveFindings: vi.fn(async () => ({ count: 0 })),
      upsertRecommendation: vi.fn(async () => ({})),
    };
    const service = new SecurityIntelligenceService(store);

    const result = await service.ingestTechnologyAdvisories(
      [
        {
          category: 'TECHNOLOGY_WATCH',
          technologyId: 'nextjs',
          technology: 'Vercel Next.js',
          identifiers: ['GHSA-aaaa-bbbb-cccc', 'CVE-2026-1234'],
          affectedVersions: ['>=14.0.0'],
          fixedVersions: ['15.0.1'],
          modifiedAt: new Date('2026-11-03T10:00:00Z'),
          severity: [
            {
              source: 'nvd@nist.gov',
              type: 'CVSS_V3.1:CRITICAL:9.8',
              vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
            },
          ],
          references: ['https://github.com/advisories/GHSA-aaaa-bbbb-cccc'],
          source: 'OSV',
          potentialRelevance: 'Structured package identity matched.',
          requiresDeploymentVerification: true,
          kev: { listed: true, source: 'CISA' },
        },
      ],
      ['nextjs'],
      new Date('2026-11-04T10:00:00Z'),
    );

    expect(result.counts.new).toBe(1);
    expect(upsertFinding.mock.calls[0]?.[0]).toMatchObject({
      type: 'TECHNOLOGY_ADVISORY',
      severity: 'CRITICAL',
      evidence: {
        category: 'TECHNOLOGY_WATCH',
        requiresDeploymentVerification: true,
      },
    });
    expect(
      (upsertFinding.mock.calls[0]?.[0].description ?? '').toLowerCase(),
    ).toContain('not confirmed');
  });

  it('rebuilds daily and weekly report items from persisted open and recently resolved security findings', async () => {
    const now = new Date('2026-11-04T10:00:00Z');
    const store = {
      listSecurityFindings: vi.fn(async () => [
        {
          id: 'confirmed-id',
          fingerprint: 'confirmed-fingerprint',
          status: 'OPEN' as const,
          type: 'SECURITY_VULNERABILITY',
          severity: 'HIGH',
          title: 'OpenSSL issue',
          firstSeenAt: new Date('2026-11-01T10:00:00Z'),
          lastSeenAt: now,
          updatedAt: now,
          evidence: {
            category: 'CONFIRMED_ENVIRONMENT',
            lifecycle: 'PERSISTENT',
            service: 'production-image',
            component: 'openssl',
            installedVersion: '3.0.0',
            fixedVersion: '3.0.1',
            identifiers: ['CVE-2026-9000'],
            cvss: [{ source: 'nvd', version: '3.1', score: 8.8 }],
            scanKey: 'sha256:image',
          },
        },
        {
          id: 'resolved-id',
          fingerprint: 'resolved-fingerprint',
          status: 'RESOLVED' as const,
          type: 'TECHNOLOGY_ADVISORY',
          severity: 'MEDIUM',
          title: 'Resolved watch item',
          firstSeenAt: new Date('2026-10-01T10:00:00Z'),
          updatedAt: new Date('2026-11-03T10:00:00Z'),
          evidence: {
            category: 'TECHNOLOGY_WATCH',
            technology: 'Example runtime',
            identifiers: ['CVE-2026-9001'],
            fixedVersions: [],
            cvss: [],
            modifiedAt: '2026-11-03T10:00:00.000Z',
          },
        },
      ]),
      upsertFinding: vi.fn(),
      resolveFindings: vi.fn(),
      upsertRecommendation: vi.fn(),
    };

    const items = await new SecurityIntelligenceService(
      store,
    ).currentReportItems(now, new Date('2026-10-28T10:00:00Z'));

    expect(items).toEqual([
      expect.objectContaining({
        fingerprint: 'confirmed-fingerprint',
        lifecycle: 'PERSISTENT',
        subject: 'production-image: openssl 3.0.0',
        ageDays: 3,
      }),
      expect.objectContaining({
        fingerprint: 'resolved-fingerprint',
        category: 'TECHNOLOGY_WATCH',
        lifecycle: 'RESOLVED',
      }),
    ]);
  });
});
