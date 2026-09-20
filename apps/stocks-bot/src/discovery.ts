import {
  discoveryCompanyIsEligible,
  selectDiscoveryCandidates,
  type DiscoveryPolicy,
  type DiscoveryScanMode,
  type MarketDiscoveryScanner,
} from './core/index.js';
import {
  errorMessage,
  type WatcherLogger,
  type WatchItem,
} from '@watcher/core';
import {
  type DiscoveryCompanyProfile,
  type StockDiscoveryStore,
} from '@watcher/database';
import { discoveryOpportunityScore } from './discovery-catalyst.js';
import type { DiscoveryCatalystAnalyzer } from './discovery-catalyst.js';

export type DiscoveryExecution =
  | { status: 'BUSY' }
  | {
      status: 'COMPLETED';
      scanId: string;
      observedCount: number;
      candidateCount: number;
      recommendedCandidates: Array<{
        ticker: string;
        companyName: string;
        changePercent: number;
        attentionScore: number;
        reason: string;
      }>;
      rejectedCount: number;
      durationMs: number;
    }
  | { status: 'FAILED'; error: string; durationMs: number };

type CompanyLookup = (symbol: string) => Promise<DiscoveryCompanyProfile>;
type DiscoveryNewsLookup = (
  input: { symbol: string; companyName: string; exchange: string | null },
  signal?: AbortSignal,
) => Promise<WatchItem[]>;

const maximumCatalystReviews = 5;

export class StockDiscoveryCoordinator {
  public constructor(
    private readonly store: StockDiscoveryStore,
    private readonly scanner: MarketDiscoveryScanner,
    private readonly lookupCompany: CompanyLookup,
    private readonly scanMode: DiscoveryScanMode,
    private readonly weeklySchedule: string,
    private readonly policy: DiscoveryPolicy,
    private readonly fetchNews: DiscoveryNewsLookup,
    private readonly catalystAnalyzer: DiscoveryCatalystAnalyzer,
    private readonly logger?: WatcherLogger,
  ) {}

  public async execute(
    watcherConfigId: string,
    _chatId: bigint,
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
      const recommendedCandidates: Extract<
        DiscoveryExecution,
        { status: 'COMPLETED' }
      >['recommendedCandidates'] = [];
      let rejectedCount = 0;
      let resolutionFailureCount = 0;

      for (const candidate of candidates.slice(0, maximumCatalystReviews)) {
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
          const freshAfter = new Date(Date.now() - 7 * 24 * 60 * 60_000);
          const articles = (
            await this.fetchNews(
              {
                symbol: candidate.ticker,
                companyName: profile.companyName,
                exchange: profile.exchange,
              },
              signal,
            )
          ).filter(
            (article) =>
              article.publishedAt && article.publishedAt >= freshAfter,
          );
          if (articles.length === 0) {
            rejectedCount += 1;
            this.logger?.info(
              { watcherConfigId, scanId: scan.id, ticker: candidate.ticker },
              'Discovery candidate rejected because no fresh news was found',
            );
            continue;
          }
          const assessment = await this.catalystAnalyzer.assess(
            {
              ticker: candidate.ticker,
              companyName: profile.companyName,
              changePercent: candidate.changePercent,
              articles,
            },
            signal,
          );
          if (
            !assessment.qualifies ||
            assessment.direction !== 'POSITIVE' ||
            assessment.confirmation === 'NONE' ||
            assessment.upsidePotential < 5 ||
            assessment.catalystStrength < 5 ||
            assessment.pricedIn === 'OVERPRICED_EXPECTATIONS'
          ) {
            rejectedCount += 1;
            this.logger?.info(
              {
                watcherConfigId,
                scanId: scan.id,
                ticker: candidate.ticker,
                confirmation: assessment.confirmation,
                pricedIn: assessment.pricedIn,
              },
              'Discovery candidate rejected by catalyst assessment',
            );
            continue;
          }
          const opportunityScore = discoveryOpportunityScore(
            assessment,
            candidate.changePercent,
          );
          const recorded = await this.store.recordCandidate(
            watcherConfigId,
            scan.id,
            {
              ...candidate,
              attentionScore: opportunityScore,
              reason: `${assessment.catalyst} · current move ${candidate.changePercent >= 0 ? '+' : ''}${candidate.changePercent.toFixed(2)}% · ${assessment.pricedIn.replaceAll('_', ' ').toLowerCase()}`,
            },
          );
          if (recorded.recorded) {
            recommendedCandidates.push({
              ticker: recorded.ticker,
              companyName: profile.companyName,
              changePercent: candidate.changePercent,
              attentionScore: opportunityScore,
              reason: [
                `Catalyst: ${assessment.catalyst}`,
                `Assessment: ${assessment.explanation}`,
                `Confirmation: ${assessment.confirmation.replaceAll('_', ' ').toLowerCase()} · pricing: ${assessment.pricedIn.replaceAll('_', ' ').toLowerCase()}`,
                `Risks: ${assessment.risks.join('; ')}`,
              ].join('\n'),
            });
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
          activatedCount: recommendedCandidates.length,
          ...(resolutionFailureCount > 0
            ? {
                error: `${resolutionFailureCount} candidates could not be resolved`,
              }
            : {}),
        },
        this.weeklySchedule,
      );
      this.logger?.info(
        {
          watcherConfigId,
          scanId: scan.id,
          observedCount: observations.length,
          candidateCount: candidates.length,
          recommendedCount: recommendedCandidates.length,
          rejectedCount,
          durationMs: Date.now() - startedAt,
        },
        'Discovery scan completed',
      );
      return {
        status: 'COMPLETED',
        scanId: scan.id,
        observedCount: observations.length,
        candidateCount: candidates.length,
        recommendedCandidates,
        rejectedCount,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      const message = errorMessage(error);
      await this.store.finishScan(
        watcherConfigId,
        scan.id,
        { status: 'FAILED', error: message },
        this.weeklySchedule,
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
