import { deduplicateItems } from './deduplicate.js';
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
  ) {}

  public async run(
    kind: WatcherKind,
    runId: string,
    requests: SourceRequest[],
    options: PipelineRunOptions = {},
  ): Promise<PipelineResult> {
    await options.onProgress?.({ percent: 20, step: 'Fetching sources' });
    const settled = await Promise.allSettled(
      requests.map(async ({ source, target, config }) => ({
        items: await source.fetch(config, options.signal),
        source: source.id,
        target,
      })),
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
        sourceFailures.push({
          source: request.source.id,
          target: request.target,
          message: errorMessage(result.reason),
        });
      }
    });

    await options.onProgress?.({ percent: 45, step: 'Preparing new items' });
    const preparedItems = await this.repository.prepareItemsForRun(
      kind,
      runId,
      deduplicateItems(fetchedItems),
      this.maxItemsPerRun,
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
          outcome = await this.analyzer.analyze(kind, item, options.signal);
        } catch (error) {
          outcome = { status: 'FAILED' as const, error: errorMessage(error) };
        }
      }
      await this.repository.saveAnalysis(runId, recordId, outcome);
      analyses.push({ item, outcome });
    }

    await options.onProgress?.({ percent: 90, step: 'Saving results' });
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
