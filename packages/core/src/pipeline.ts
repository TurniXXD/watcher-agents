import { deduplicateItems } from './deduplicate.js';
import type { WatcherLogger } from './logger.js';
import type {
  Analyzer,
  PipelineRepository,
  PipelineResult,
  ProgressReporter,
  SourceFailure,
  SourceRequest,
  WatcherKind,
  WatchItem,
} from './types.js';

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

type PipelineRunOptions = {
  analysisStep?: string;
  onProgress?: ProgressReporter;
  signal?: AbortSignal;
};

export class WatcherPipeline {
  public constructor(
    private readonly repository: PipelineRepository,
    private readonly analyzer: Analyzer,
    private readonly maxItemsPerRun = 0,
    private readonly logger?: WatcherLogger,
  ) {}

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
    const settled = await Promise.allSettled(
      requests.map(async ({ source, target, config }) => {
        const sourceStartedAt = Date.now();
        this.logger?.debug(
          { kind, runId, source: source.id, target },
          'Fetching watcher source',
        );
        const items = await source.fetch(config, options.signal);
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
        return {
          items,
          source: source.id,
          target,
        };
      }),
    );

    const fetchedItems: WatchItem[] = [];
    const sourceFailures: SourceFailure[] = [];

    settled.forEach((result, index) => {
      const request = requests[index];
      if (!request) return;

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
          outcome = await this.analyzer.analyze(kind, item, options.signal);
        } catch (error) {
          this.logger?.warn(
            {
              kind,
              runId,
              source: item.source,
              externalId: item.externalId,
              err: error,
            },
            'Watcher item analysis failed',
          );
          outcome = { status: 'FAILED' as const, error: errorMessage(error) };
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
    this.logger?.info(
      {
        kind,
        runId,
        fetchedCount: fetchedItems.length,
        newItemCount: preparedItems.length,
        analyzedCount: analyses.filter(
          ({ outcome }) => outcome.status === 'SUCCESS',
        ).length,
        failedAnalysisCount: analyses.filter(
          ({ outcome }) => outcome.status === 'FAILED',
        ).length,
        sourceFailureCount: sourceFailures.length,
      },
      'Watcher pipeline completed',
    );
    return {
      fetchedCount: fetchedItems.length,
      newItemCount: preparedItems.length,
      analyzedCount: analyses.filter(
        ({ outcome }) => outcome.status === 'SUCCESS',
      ).length,
      failedAnalysisCount: analyses.filter(
        ({ outcome }) => outcome.status === 'FAILED',
      ).length,
      analyses,
      sourceFailures,
    };
  }
}
