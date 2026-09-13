import type { NormalizedObservation } from '@watcher/core';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient } from '../client.js';
import { StockSpecializedSignalStore } from '../specialized-signal-store.js';
import {
  defaultAdvancedSignalPolicy,
  defaultMarketAnomalyPolicy,
  type CanonicalEventCandidate,
} from '../stock-domain/index.js';

describe('StockSpecializedSignalStore', () => {
  it('omits provider numbers outside PostgreSQL decimal ranges', async () => {
    const upsert = vi.fn<(input: unknown) => Promise<void>>(
      async () => undefined,
    );
    const database = {
      insiderSignal: {
        upsert,
        findMany: vi.fn(async () => []),
        update: vi.fn(async () => undefined),
      },
    } as unknown as DatabaseClient;
    const store = new StockSpecializedSignalStore(
      database,
      defaultMarketAnomalyPolicy,
      defaultAdvancedSignalPolicy,
    );
    const discoveredAt = new Date('2026-09-12T12:00:00.000Z');
    const observation: NormalizedObservation = {
      id: 'overflow',
      watcherKind: 'STOCKS',
      ticker: 'MU',
      source: 'FINVIZ',
      sourceType: 'OTHER',
      sourceUrl: 'https://example.test/filing',
      primarySource: false,
      publishedAt: discoveredAt,
      discoveredAt,
      eventAt: discoveredAt,
      category: 'INSIDER_TRANSACTION',
      headline: 'Malformed provider magnitudes',
      rawText: 'Malformed provider magnitudes',
      normalizedFacts: {
        owner: 'Provider Overflow Test',
        transactionCode: 'P',
        acquiredDisposedCode: 'A',
        shares: 1e25,
        pricePerShare: 1e20,
        sharesOwnedFollowing: 1e25,
      },
      entities: ['MU'],
      reliability: 0.8,
      metadata: {},
    };
    const candidate: CanonicalEventCandidate = {
      ticker: 'MU',
      eventType: 'INSIDER_TRANSACTION',
      eventTypes: ['INSIDER_TRANSACTION'],
      title: observation.headline,
      occurredAt: discoveredAt,
      firstPublicAt: discoveredAt,
      firstDetectedAt: discoveredAt,
      direction: 'UNKNOWN',
      magnitude: {},
      surprise: 'UNKNOWN',
      materiality: 'LOW',
      materialityScore: 20,
      materialityReasons: [],
      action: 'STORE',
      fingerprint: 'fingerprint',
      evidencePriority: 50,
    };

    await expect(
      store.enrichCandidate('processed-item', observation, candidate),
    ).resolves.toBeDefined();

    expect(upsert).toHaveBeenCalledOnce();
    const input = upsert.mock.calls[0]?.[0] as
      { create?: Record<string, unknown> } | undefined;
    expect(input?.create).toMatchObject({
      shares: null,
      price: null,
      transactionValue: null,
      holdingsAfter: null,
    });
    const rationale = input?.create?.rationale;
    expect(Array.isArray(rationale)).toBe(true);
    expect(
      Array.isArray(rationale) &&
        rationale.some(
          (entry) =>
            typeof entry === 'string' &&
            entry.includes('Ignored out-of-range provider values'),
        ),
    ).toBe(true);
  });
});
