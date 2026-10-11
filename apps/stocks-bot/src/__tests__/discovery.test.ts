import {
  defaultDiscoveryPolicy,
  type MarketDiscoveryScanner,
} from '../core/index.js';
import type { StockDiscoveryStore } from '@watcher/database';
import { describe, expect, it, vi } from 'vitest';
import type { DiscoveryCatalystAnalyzer } from '../discovery-catalyst.js';
import { StockDiscoveryCoordinator } from '../discovery.js';

describe('StockDiscoveryCoordinator screening', () => {
  it('records a quiet most-active value candidate without invoking catalyst analysis', async () => {
    const recordCandidate = vi
      .fn()
      .mockResolvedValue({ recorded: true, ticker: 'VALUE' });
    const finishScan = vi.fn().mockResolvedValue(undefined);
    const store = {
      claimScan: vi.fn().mockResolvedValue({ id: 'scan-1' }),
      recordCandidate,
      finishScan,
    } as unknown as StockDiscoveryStore;
    const scanner = {
      id: 'TEST',
      scan: vi.fn().mockResolvedValue([
        {
          ticker: 'VALUE',
          price: 20,
          changePercent: 0.5,
          volume: 2_000_000,
          observedAt: new Date('2026-10-10T16:00:00Z'),
          snapshotId: 'snapshot-1',
          source: 'TEST',
          trigger: 'MOST_ACTIVE',
        },
      ]),
    } satisfies MarketDiscoveryScanner;
    const fetchNews = vi.fn();
    const assessCatalyst = vi.fn();
    const coordinator = new StockDiscoveryCoordinator(
      store,
      scanner,
      vi.fn().mockResolvedValue({
        symbol: 'VALUE',
        companyName: 'Value Corp',
        cik: '0000000001',
        exchange: 'Nasdaq',
        industry: 'Software',
        investorRelationsUrl: null,
      }),
      'DAILY',
      '0 15 * * 0',
      defaultDiscoveryPolicy,
      fetchNews,
      { assess: assessCatalyst } as unknown as DiscoveryCatalystAnalyzer,
      vi.fn().mockResolvedValue({
        signals: ['UNDERVALUED'],
        primaryTrigger: 'UNDERVALUED',
        rsi14: 45,
        forwardPe: 10,
        analystRank: 1,
        attentionScore: 90,
        reason: 'Potential value screen.',
        sourceFailures: [],
      }),
    );

    const result = await coordinator.execute('watcher-1', 123n, 'MANUAL');

    expect(result).toMatchObject({
      status: 'COMPLETED',
      candidateCount: 1,
      recommendedCandidates: [
        {
          ticker: 'VALUE',
          signals: ['UNDERVALUED'],
          forwardPe: 10,
        },
      ],
    });
    expect(recordCandidate).toHaveBeenCalledWith(
      'watcher-1',
      'scan-1',
      expect.objectContaining({
        ticker: 'VALUE',
        trigger: 'MOST_ACTIVE',
        screeningSignals: ['UNDERVALUED'],
        reason: 'Potential value screen.',
      }),
    );
    expect(fetchNews).not.toHaveBeenCalled();
    expect(assessCatalyst).not.toHaveBeenCalled();
    expect(finishScan).toHaveBeenCalledWith(
      'watcher-1',
      'scan-1',
      expect.objectContaining({ status: 'SUCCESS', activatedCount: 1 }),
      '0 15 * * 0',
    );
  });
});
