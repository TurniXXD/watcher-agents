import type { PipelineResult } from '@watcher/core';
import { formatRunDuration } from '@watcher/telegram';

const sourceList = (sources: string[]): string =>
  [...new Set(sources)].slice(0, 4).join(', ');

const analysisFailureKind = (error: string): string => {
  const stage = /^((?:targeted|full|scoring) stock analysis failed):/i.exec(
    error,
  )?.[1];
  const phase = stage ? `${stage}: ` : '';
  if (/timed out|timeout|aborterror/i.test(error))
    return `${phase}Ollama request timed out`;
  if (/model.*not found|Ollama returned HTTP 404/i.test(error))
    return `${phase}Ollama model or endpoint was not found`;
  const httpStatus = /Ollama returned HTTP (\d{3})/i.exec(error)?.[1];
  if (httpStatus) return `${phase}Ollama returned HTTP ${httpStatus}`;
  if (/queue.*(?:wait|timeout|expired)/i.test(error))
    return `${phase}Ollama queue wait expired`;
  if (/json|schema|validat|invalid|token limit|truncat|expected/i.test(error))
    return `${phase}structured output was incomplete or invalid`;
  return `${phase}see the stored error in stocks-bot logs`;
};

export const renderThesisNotReady = (
  ticker: string,
  result: PipelineResult,
): string => {
  const coverage = result.dataCoverage;
  const intelligence = result.intelligence;
  const sourceFailures = sourceList(
    result.sourceFailures.map(({ source }) => source),
  );
  const failedAnalyses = result.analyses.flatMap(({ item, outcome }) =>
    outcome.status === 'FAILED'
      ? [{ source: item.source, reason: analysisFailureKind(outcome.error) }]
      : [],
  );
  const analysisFailures = sourceList(
    failedAnalyses.map(({ source }) => source),
  );
  const failureDetails = failedAnalyses
    .slice(0, 4)
    .map(({ source, reason }) => `• ${source}: ${reason}`);
  const createdEvents =
    intelligence?.eventsCreated ?? intelligence?.newEventCount ?? 0;
  const analyzedEvents = intelligence?.eventsAnalyzed ?? result.analyzedCount;
  const reasons = [
    createdEvents === 0
      ? 'This run did not create a usable canonical company event. Most observations were either unchanged, duplicate, or state snapshots rather than a new issuer, regulatory, earnings, guidance, or comparable company event.'
      : '',
    analyzedEvents === 0
      ? 'No event completed the targeted analysis needed to initialise a thesis.'
      : '',
    result.failedAnalysisCount > 0
      ? `${result.failedAnalysisCount} analysis ${result.failedAnalysisCount === 1 ? 'attempt failed' : 'attempts failed'}${analysisFailures ? ` (${analysisFailures})` : ''}. A failed analysis is never converted into a thesis.`
      : '',
  ].filter(Boolean);
  const nextSteps = [
    result.failedAnalysisCount > 0
      ? `Fix the analysis failure shown above, then run /thesis ${ticker} again. Failed events remain retryable; a new company event is not required.`
      : 'A thesis becomes ready when Watcher has a canonical ticker event and a successful targeted analysis can validate the evidence and risks.',
    sourceFailures
      ? `Source ${sourceFailures} did not return data. Other sources were still used; inspect /health if this persists.`
      : '',
    result.failedAnalysisCount === 0
      ? 'Historical snapshots alone are not promoted into a thesis without an auditable event chain.'
      : '',
  ].filter(Boolean);
  return [
    `🧠 THESIS NOT READY · ${ticker}`,
    `Live refresh completed in ${formatRunDuration(result.durationMs ?? 0)}. Fetched ${result.fetchedCount} observations from ${coverage?.successfulSources ?? 0}/${coverage?.expectedSources ?? 0} enabled sources.`,
    `Event processing: ${createdEvents} new canonical events · ${intelligence?.duplicateEventCount ?? 0} duplicates · ${intelligence?.storedOnlyCount ?? 0} stored-only · ${analyzedEvents} analyzed.`,
    'Why no thesis yet',
    ...reasons.map((reason) => `• ${reason}`),
    ...failureDetails,
    'What must happen next',
    ...nextSteps.map((step) => `• ${step}`),
    result.failedAnalysisCount > 0
      ? 'The stocks-bot log contains the full stored analysis error for each failed item.'
      : `Next action: run /thesis ${ticker} after new material company evidence arrives.`,
  ].join('\n\n');
};
