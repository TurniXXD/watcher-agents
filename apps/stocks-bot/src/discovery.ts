import {
  discoveryCompanyIsEligible,
  selectDiscoveryCandidates,
  type DiscoveryPolicy,
  type DiscoveryScanMode,
  type MarketDiscoveryScanner,
} from './core/index.js';
import { errorMessage, type WatcherLogger } from '@watcher/core';
import {
  type DiscoveryCompanyProfile,
  type StockDiscoveryStore,
} from '@watcher/database';

export type DiscoveryExecution =
  | { status: 'BUSY' }
  | {
      status: 'COMPLETED';
      observedCount: number;
      candidateCount: number;
      activatedTickers: string[];
      rejectedCount: number;
      durationMs: number;
    }
  | { status: 'FAILED'; error: string; durationMs: number };

type CompanyLookup = (symbol: string) => Promise<DiscoveryCompanyProfile>;
type InvestigationRun = (
  configId: string,
  chatId: bigint,
  tickers: string[],
) => Promise<void>;

export class StockDiscoveryCoordinator {
  public constructor(
    private readonly store: StockDiscoveryStore,
    private readonly scanner: MarketDiscoveryScanner,
    private readonly lookupCompany: CompanyLookup,
    private readonly runInvestigation: InvestigationRun,
    private readonly scanMode: DiscoveryScanMode,
    private readonly scanIntervalMs: number,
    private readonly policy: DiscoveryPolicy,
    private readonly logger?: WatcherLogger,
  ) {}

  public async execute(
    watcherConfigId: string,
    chatId: bigint,
    trigger: 'MANUAL' | 'SCHEDULED',
    signal?: AbortSignal,
  ): Promise<DiscoveryExecution> {
    const scan = await this.store.claimScan(
      watcherConfigId,
      trigger,
      this.scanMode,
    );
    if (!scan) {
      return { status: 'BUSY' };
    }
    const startedAt = Date.now();
    this.logger?.info(
      { watcherConfigId, scanId: scan.id, trigger, mode: this.scanMode },
      'Discovery scan started',
    );
    try {
      const observations = await this.scanner.scan(this.scanMode, signal);
      const candidates = selectDiscoveryCandidates(observations, this.policy);
      const activatedTickers: string[] = [];
      let rejectedCount = 0;
      let resolutionFailureCount = 0;

      for (const candidate of candidates) {
        try {
          const profile = await this.lookupCompany(candidate.ticker);
          if (!discoveryCompanyIsEligible(profile.exchange, this.policy)) {
            rejectedCount += 1;
            this.logger?.info(
              {
                watcherConfigId,
                scanId: scan.id,
                ticker: candidate.ticker,
                exchange: profile.exchange,
              },
              'Discovery candidate rejected by exchange quality filter',
            );
            continue;
          }
          const activated = await this.store.activateCandidate(
            watcherConfigId,
            scan.id,
            candidate,
            profile,
          );
          if (activated.activated) {
            activatedTickers.push(activated.ticker);
          }
        } catch (error) {
          rejectedCount += 1;
          resolutionFailureCount += 1;
          this.logger?.warn(
            {
              watcherConfigId,
              scanId: scan.id,
              ticker: candidate.ticker,
              err: error,
            },
            'Discovery candidate rejected during company resolution',
          );
        }
      }

      await this.store.finishScan(
        watcherConfigId,
        scan.id,
        {
          status: resolutionFailureCount > 0 ? 'PARTIAL' : 'SUCCESS',
          observedCount: observations.length,
          candidateCount: candidates.length,
          activatedCount: activatedTickers.length,
          ...(resolutionFailureCount > 0
            ? {
                error: `${resolutionFailureCount} candidates could not be resolved`,
              }
            : {}),
        },
        this.scanIntervalMs,
      );
      if (activatedTickers.length > 0) {
        await this.runInvestigation(watcherConfigId, chatId, activatedTickers);
      }
      this.logger?.info(
        {
          watcherConfigId,
          scanId: scan.id,
          observedCount: observations.length,
          candidateCount: candidates.length,
          activatedCount: activatedTickers.length,
          rejectedCount,
          durationMs: Date.now() - startedAt,
        },
        'Discovery scan completed',
      );
      return {
        status: 'COMPLETED',
        observedCount: observations.length,
        candidateCount: candidates.length,
        activatedTickers,
        rejectedCount,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      const message = errorMessage(error);
      await this.store.finishScan(
        watcherConfigId,
        scan.id,
        { status: 'FAILED', error: message },
        this.scanIntervalMs,
      );
      this.logger?.error(
        {
          watcherConfigId,
          scanId: scan.id,
          durationMs: Date.now() - startedAt,
          err: error,
        },
        'Discovery scan failed',
      );
      return {
        status: 'FAILED',
        error: message,
        durationMs: Date.now() - startedAt,
      };
    }
  }
}
