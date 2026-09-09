import { median } from './statistics.js';
import type { RunObservation, SourceHealth, SourceObservation } from './types.js';

const dayMs = 86_400_000;

export const calculateSourceHealth = (
  runs: RunObservation[],
  now: Date,
): SourceHealth[] => {
  const grouped = new Map<string, { agentName: string; sourceId: string; rows: SourceObservation[] }>();
  for (const run of runs) {
    for (const source of run.sources) {
      const key = `${run.agentName}\u0000${source.sourceId}`;
      const group = grouped.get(key) ?? {
        agentName: run.agentName,
        sourceId: source.sourceId,
        rows: [],
      };
      group.rows.push(source);
      grouped.set(key, group);
    }
  }
  return [...grouped.values()].map(({ agentName, sourceId, rows }) => {
    const ordered = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const successful = ordered.filter((row) => row.status.toLowerCase() === 'success');
    const produced = successful.filter((row) => (row.itemCount ?? 0) > 0);
    const intervals = produced.slice(1).map((row, index) =>
      (row.createdAt.getTime() - produced[index]!.createdAt.getTime()) / dayMs,
    );
    const updateMedian = median(intervals);
    const lastNewItemAt = produced.at(-1)?.createdAt;
    let consecutiveFailures = 0;
    for (const row of [...ordered].reverse()) {
      if (row.status.toLowerCase() === 'success') break;
      consecutiveFailures++;
    }
    const totalItems = ordered.reduce((sum, row) => sum + (row.itemCount ?? 0), 0);
    return {
      agentName,
      sourceId,
      windowStartedAt: ordered[0]?.createdAt ?? now,
      windowEndedAt: now,
      totalRuns: ordered.length,
      successfulRuns: successful.length,
      failedRuns: ordered.length - successful.length,
      successRate: ordered.length === 0 ? 1 : successful.length / ordered.length,
      ...(successful.at(-1) ? { lastSuccessfulAt: successful.at(-1)!.createdAt } : {}),
      ...(lastNewItemAt ? { lastNewItemAt } : {}),
      ...(ordered.some((row) => row.latencyMs !== null && row.latencyMs !== undefined)
        ? {
            averageLatencyMs:
              ordered.reduce((sum, row) => sum + (row.latencyMs ?? 0), 0) /
              ordered.filter((row) => row.latencyMs !== null && row.latencyMs !== undefined).length,
          }
        : {}),
      consecutiveFailures,
      itemsProduced: totalItems,
      uniqueItemsProduced: totalItems,
      ...(lastNewItemAt ? { staleDays: (now.getTime() - lastNewItemAt.getTime()) / dayMs } : {}),
      ...(updateMedian === undefined ? {} : { historicalMedianUpdateDays: updateMedian }),
    };
  });
};
