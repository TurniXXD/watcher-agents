import { deduplicateItems } from './deduplicate.js';
import type { WatcherLogger } from './logger.js';
import {
  ProviderRequestLimiter,
  type ProviderRequestPolicy,
} from './provider-limiter.js';
import { isSourceRateLimited, sourceRetryAt } from './source-http-error.js';
import { errorMessage } from './utils/general.js';
import {
  watchItemSchema,
  type Analyzer,
  type PipelineRepository,
  type PipelineResult,
  type ProgressReporter,
  type SourceFailure,
  type Source,
  type SourceRequest,
  type WatcherKind,
  type WatchItem,
} from './types.js';

class SourceBackoffError extends Error {
  public override readonly name = 'SourceBackoffError';

  public constructor(
    message: string,
    public readonly retryAt?: Date,
  ) {
    super(message);
  }
}

type PipelineRunOptions = {
  analysisStep?: string;
  onProgress?: ProgressReporter;
  signal?: AbortSignal;
};

export class WatcherPipeline {
  private readonly providerLimiters = new Map<string, ProviderRequestLimiter>();

  public constructor(
    private readonly repository: PipelineRepository,
    private readonly analyzer: Analyzer,
    private readonly maxItemsPerRun = 0,
    private readonly logger?: WatcherLogger,
  ) {}

  private providerPolicy(source: Source): ProviderRequestPolicy {
    if (source.capabilities?.requestPolicy) {
      return source.capabilities.requestPolicy;
    }
    const rateLimit = source.capabilities?.rateLimitPerMinute;
    return {
      maxConcurrency: rateLimit ? 1 : 4,
      minimumSpacingMs: rateLimit ? Math.ceil(60_000 / rateLimit) : 0,
      sharedRateLimitBackoff: true,
    };
  }

  private limiterFor(source: Source): ProviderRequestLimiter {
    const policy = this.providerPolicy(source);
    const providerKey = policy.providerKey ?? source.id;
    const existing = this.providerLimiters.get(providerKey);
    if (existing) return existing;
    const limiter = new ProviderRequestLimiter(policy);
    this.providerLimiters.set(providerKey, limiter);
    return limiter;
  }

  public async run(
    kind: WatcherKind,
    runId: string,
    requests: SourceRequest[],
    options: PipelineRunOptions = {},
  ): Promise<PipelineResult> {
    await options.onProgress?.({ percent: 20, step: 'Fetching sources' });
    this.logger?.info(
      { kind, runId, sourceRequestCount: requests.length },
      'Fetching watcher sources',
    );
    const sourceRuns: NonNullable<PipelineResult['sourceRuns']> = [];
    const settled = await Promise.allSettled(
      requests.map(({ source, target, config }) => {
        const sourceStartedAt = Date.now();
        return this.limiterFor(source)
          .run(async () => {
            const policy = this.providerPolicy(source);
            const attemptAt = new Date();
            const attempt = await this.repository.sourceAttemptDecision?.(
              kind,
              runId,
              source.id,
              target,
              attemptAt,
              {
                ...(policy.providerKey
                  ? { providerKey: policy.providerKey }
                  : {}),
                sharedRateLimitBackoff: policy.sharedRateLimitBackoff,
              },
            );
            if (attempt && !attempt.allowed) {
              const retry = attempt.retryAt
                ? ` until ${attempt.retryAt.toISOString()}`
                : '';
              throw new SourceBackoffError(
                `${attempt.status ?? 'UNAVAILABLE'} backoff active${retry}`,
                attempt.retryAt,
              );
            }
            this.logger?.debug(
              { kind, runId, source: source.id, target },
              'Fetching watcher source',
            );
            let items: WatchItem[];
            try {
              items = (await source.fetch(config, options.signal)).map((item) =>
                watchItemSchema.parse(item),
              );
              await this.repository.recordSourceSuccess?.(
                kind,
                runId,
                source.id,
                target,
                new Date(),
                {
                  ...(policy.providerKey
                    ? { providerKey: policy.providerKey }
                    : {}),
                  sharedRateLimitBackoff: policy.sharedRateLimitBackoff,
                },
              );
            } catch (error) {
              const retryAt = sourceRetryAt(error);
              await this.repository.recordSourceFailure?.(
                kind,
                runId,
                source.id,
                target,
                errorMessage(error),
                new Date(),
                {
                  ...(policy.providerKey
                    ? { providerKey: policy.providerKey }
                    : {}),
                  sharedRateLimitBackoff: policy.sharedRateLimitBackoff,
                  rateLimited: isSourceRateLimited(error),
                  ...(retryAt ? { retryAt } : {}),
                },
              );
              throw error;
            }
            this.logger?.info(
              {
                kind,
                runId,
                source: source.id,
                target,
                itemCount: items.length,
                durationMs: Date.now() - sourceStartedAt,
              },
              'Watcher source fetched',
            );
            sourceRuns.push({
              source: source.id,
              target,
              status: 'SUCCESS',
              durationMs: Date.now() - sourceStartedAt,
              itemCount: items.length,
            });
            return {
              items,
              source: source.id,
              target,
            };
          })
          .catch((error: unknown) => {
            sourceRuns.push({
              source: source.id,
              target,
              status: 'FAILED',
              durationMs: Date.now() - sourceStartedAt,
              itemCount: 0,
              error: errorMessage(error),
            });
            throw error;
          });
      }),
    );

    const fetchedItems: WatchItem[] = [];
    const sourceFailures: SourceFailure[] = [];

    settled.forEach((result, index) => {
      const request = requests[index];
      if (!request) {
        return;
      }

      if (result.status === 'fulfilled') {
        fetchedItems.push(
          ...result.value.items.map((item) => ({
            ...item,
            metadata: { ...item.metadata, target: result.value.target },
          })),
        );
      } else {
        this.logger?.warn(
          {
            kind,
            runId,
            source: request.source.id,
            target: request.target,
            err: result.reason,
          },
          'Watcher source failed',
        );
        sourceFailures.push({
          source: request.source.id,
          target: request.target,
          message: errorMessage(result.reason),
        });
      }
    });

    await options.onProgress?.({ percent: 45, step: 'Preparing new items' });
    const uniqueItems = deduplicateItems(fetchedItems);
    this.logger?.info(
      {
        kind,
        runId,
        fetchedCount: fetchedItems.length,
        uniqueItemCount: uniqueItems.length,
        sourceFailureCount: sourceFailures.length,
        maxItemsPerRun: this.maxItemsPerRun,
      },
      'Preparing watcher items',
    );
    const preparedItems = await this.repository.prepareItemsForRun(
      kind,
      runId,
      uniqueItems,
      this.maxItemsPerRun,
    );
    this.logger?.info(
      { kind, runId, preparedItemCount: preparedItems.length },
      'Watcher items prepared',
    );
    const analyses: PipelineResult['analyses'] = [];

    for (const [
      index,
      { item, recordId, outcome: cachedOutcome },
    ] of preparedItems.entries()) {
      const percent =
        preparedItems.length > 0
          ? 60 + Math.floor((index / preparedItems.length) * 30)
          : 90;
      await options.onProgress?.({
        percent,
        step: cachedOutcome
          ? 'Reusing cached analysis'
          : (options.analysisStep ?? 'Analyzing items'),
      });
      let outcome = cachedOutcome;
      if (!outcome) {
        const analysisStartedAt = Date.now();
        try {
          this.logger?.debug(
            {
              kind,
              runId,
              source: item.source,
              externalId: item.externalId,
              title: item.title,
            },
            'Analyzing watcher item',
          );
          const analyzed = await this.analyzer.analyze(
            kind,
            item,
            options.signal,
          );
          outcome = {
            ...analyzed,
            metrics: {
              ...analyzed.metrics,
              durationMs:
                analyzed.metrics?.durationMs ?? Date.now() - analysisStartedAt,
              llmCallCount: analyzed.metrics?.llmCallCount ?? 1,
              estimatedCostUsd: analyzed.metrics?.estimatedCostUsd ?? 0,
            },
          };
        } catch (error) {
          outcome = {
            status: 'FAILED' as const,
            error: errorMessage(error),
            metrics: {
              durationMs: Date.now() - analysisStartedAt,
              llmCallCount: 1,
              estimatedCostUsd: 0,
            },
          };
        }
      } else {
        this.logger?.debug(
          {
            kind,
            runId,
            source: item.source,
            externalId: item.externalId,
            status: outcome.status,
          },
          'Reusing cached watcher item analysis',
        );
      }
      if (outcome.status === 'FAILED') {
        this.logger?.warn(
          {
            kind,
            runId,
            source: item.source,
            externalId: item.externalId,
            analysisError: outcome.error,
          },
          'Watcher item analysis failed',
        );
      }
      await this.repository.saveAnalysis(runId, recordId, outcome);
      this.logger?.debug(
        {
          kind,
          runId,
          source: item.source,
          externalId: item.externalId,
          status: outcome.status,
        },
        'Watcher item analysis saved',
      );
      analyses.push({ item, outcome });
    }

    await options.onProgress?.({ percent: 90, step: 'Saving results' });
    const intelligence =
      await this.repository.getRunIntelligenceSummary?.(runId);
    const newItemCount = intelligence?.newEventCount ?? preparedItems.length;
    const successfulSources = settled.filter(
      ({ status }) => status === 'fulfilled',
    ).length;
    const dataCoverage = {
      expectedSources: requests.length,
      successfulSources,
      unavailableSources: requests.length - successfulSources,
      percentage:
        requests.length === 0
          ? 100
          : Math.round((successfulSources / requests.length) * 100),
    };
    this.logger?.info(
      {
        kind,
        runId,
        fetchedCount: fetchedItems.length,
        newItemCount,
        analyzedCount: analyses.filter(
          ({ outcome }) => outcome.status === 'SUCCESS',
        ).length,
        failedAnalysisCount: analyses.filter(
          ({ outcome }) => outcome.status === 'FAILED',
        ).length,
        sourceFailureCount: sourceFailures.length,
        intelligence,
        dataCoverage,
      },
      'Watcher pipeline completed',
    );
    return {
      fetchedCount: fetchedItems.length,
      newItemCount,
      analyzedCount: analyses.filter(
        ({ outcome }) => outcome.status === 'SUCCESS',
      ).length,
      failedAnalysisCount: analyses.filter(
        ({ outcome }) => outcome.status === 'FAILED',
      ).length,
      analyses,
      sourceFailures,
      sourceRuns,
      dataCoverage,
      ...(intelligence ? { intelligence } : {}),
    };
  }
}
