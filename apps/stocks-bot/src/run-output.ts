import type { PipelineResult } from '@watcher/core';

export const hasReportableStockInformation = (
  result: PipelineResult,
): boolean =>
  result.analyses.some(({ outcome }) => outcome.status === 'SUCCESS') ||
  Boolean(
    result.intelligence?.events.some(
      ({ decision }) => decision !== 'DUPLICATE',
    ),
  );

export const reportableStockResult = (
  result: PipelineResult,
): PipelineResult => ({
  ...result,
  analyses: result.analyses.filter(
    ({ outcome }) => outcome.status === 'SUCCESS',
  ),
  sourceFailures: [],
  failedAnalysisCount: 0,
});
