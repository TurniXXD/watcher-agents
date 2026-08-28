import { deduplicateItems } from './deduplicate.js';
import type {
  Analyzer,
  PipelineRepository,
  PipelineResult,
  SourceFailure,
  SourceRequest,
  WatcherKind,
  WatchItem,
} from './types.js';

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export class WatcherPipeline {
  public constructor(
    private readonly repository: PipelineRepository,
    private readonly analyzer: Analyzer,
    private readonly maxItemsPerRun = 5,
  ) {}

  public async run(
    kind: WatcherKind,
    runId: string,
    requests: SourceRequest[],
    signal?: AbortSignal,
  ): Promise<PipelineResult> {
    const settled = await Promise.allSettled(
      requests.map(async ({ source, target, config }) => ({
        items: await source.fetch(config, signal),
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

    const uniqueItems = deduplicateItems(fetchedItems);
    const reservedItems = await this.repository.reserveNewItems(
      kind,
      uniqueItems.slice(0, this.maxItemsPerRun),
    );
    const analyses: PipelineResult['analyses'] = [];

    for (const { item, recordId } of reservedItems) {
      let outcome;
      try {
        outcome = await this.analyzer.analyze(kind, item, signal);
      } catch (error) {
        outcome = { status: 'FAILED' as const, error: errorMessage(error) };
      }
      await this.repository.saveAnalysis(runId, recordId, outcome);
      analyses.push({ item, outcome });
    }

    return {
      fetchedCount: fetchedItems.length,
      newItemCount: reservedItems.length,
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
