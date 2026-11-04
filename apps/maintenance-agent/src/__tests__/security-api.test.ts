import type { WatcherLogger } from '@watcher/core';
import type { MaintenanceStore } from '@watcher/database';
import { describe, expect, it, vi } from 'vitest';
import { createMaintenanceApi } from '../api.js';
import type { MaintenanceEngine } from '../evaluation/engine.js';
import type { SecurityIntelligenceService } from '../security/service.js';

const logger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
} as unknown as WatcherLogger;

const createApi = (
  security: Pick<SecurityIntelligenceService, 'ingestTrivy'>,
) =>
  createMaintenanceApi(
    {} as MaintenanceStore,
    {} as MaintenanceEngine,
    '0123456789abcdef',
    async () => undefined,
    logger,
    security,
  );

describe('maintenance security ingestion API', () => {
  it('authenticates and validates a Trivy report before handing it to the service', async () => {
    const ingestTrivy = vi.fn(async () => ({
      findings: [],
      reportItems: [],
      counts: { new: 0, persistent: 0, resurfaced: 0, resolved: 0 },
      alertFailures: [],
    }));
    const app = createApi({ ingestTrivy });

    const response = await app.inject({
      method: 'POST',
      url: '/maintenance/security/trivy',
      headers: { authorization: 'Bearer 0123456789abcdef' },
      payload: {
        project: 'watcher',
        service: 'dependencies',
        scanKey: 'sha256:lock',
        scannedAt: '2026-11-04T10:00:00Z',
        report: { SchemaVersion: 2, Results: [] },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      findings: [],
      reportItems: [],
      counts: { new: 0, persistent: 0, resurfaced: 0, resolved: 0 },
      alertFailures: [],
    });
    expect(ingestTrivy).toHaveBeenCalledWith(
      { SchemaVersion: 2, Results: [] },
      {
        project: 'watcher',
        service: 'dependencies',
        scanKey: 'sha256:lock',
        scannedAt: new Date('2026-11-04T10:00:00Z'),
      },
    );
    await app.close();
  });

  it('rejects invalid or unauthorized reports without ingestion', async () => {
    const ingestTrivy = vi.fn();
    const app = createApi({ ingestTrivy });
    const unauthorized = await app.inject({
      method: 'POST',
      url: '/maintenance/security/trivy',
      payload: {},
    });
    const invalid = await app.inject({
      method: 'POST',
      url: '/maintenance/security/trivy',
      headers: { authorization: 'Bearer 0123456789abcdef' },
      payload: { project: 'watcher' },
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(400);
    expect(ingestTrivy).not.toHaveBeenCalled();
    await app.close();
  });

  it('accepts raw Trivy JSON with scan metadata headers for the server-side ingest helper', async () => {
    const ingestTrivy = vi.fn(async () => ({
      findings: [],
      reportItems: [],
      counts: { new: 0, persistent: 0, resurfaced: 0, resolved: 0 },
      alertFailures: [],
    }));
    const app = createApi({ ingestTrivy });
    const report = { SchemaVersion: 2, Results: [] };

    const response = await app.inject({
      method: 'POST',
      url: '/maintenance/security/trivy',
      headers: {
        authorization: 'Bearer 0123456789abcdef',
        'content-type': 'application/json',
        'x-watcher-project': 'watcher',
        'x-watcher-service': 'production-image',
        'x-watcher-scan-key': 'sha256:digest',
        'x-watcher-scanned-at': '2026-11-04T10:00:00Z',
      },
      payload: report,
    });

    expect(response.statusCode).toBe(200);
    expect(ingestTrivy).toHaveBeenCalledWith(report, {
      project: 'watcher',
      service: 'production-image',
      scanKey: 'sha256:digest',
      scannedAt: new Date('2026-11-04T10:00:00Z'),
    });
    await app.close();
  });

  it('rejects oversized reports before the ingestion service is called', async () => {
    const ingestTrivy = vi.fn();
    const app = createApi({ ingestTrivy });

    const response = await app.inject({
      method: 'POST',
      url: '/maintenance/security/trivy',
      headers: {
        authorization: 'Bearer 0123456789abcdef',
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ report: 'x'.repeat(10 * 1024 * 1024) }),
    });

    expect(response.statusCode).toBe(413);
    expect(ingestTrivy).not.toHaveBeenCalled();
    await app.close();
  });
});
