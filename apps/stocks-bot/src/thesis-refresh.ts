import type { PipelineResult } from '@watcher/core';
import { formatRunDuration } from '@watcher/telegram';

const sourceList = (sources: string[]): string =>
  [...new Set(sources)].slice(0, 4).join(', ');

export const renderThesisNotReady = (
  ticker: string,
  result: PipelineResult,
): string => {
  const coverage = result.dataCoverage;
  const intelligence = result.intelligence;
  const sourceFailures = sourceList(
    result.sourceFailures.map(({ source }) => source),
  );
  const analysisFailures = sourceList(
    result.analyses.flatMap(({ item, outcome }) =>
      outcome.status === 'FAILED' ? [item.source] : [],
    ),
  );
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
    'A thesis becomes ready when Watcher has at least one canonical ticker event and a successful targeted analysis can validate the evidence, risks, and scenario inputs.',
    sourceFailures
      ? `At least one enabled source did not return data in this run (${sourceFailures}). Retry after its backoff clears or inspect /health; other sources were still used.`
      : '',
    'Historical snapshots alone are intentionally not promoted into a thesis: they can be stale, duplicate, or lack an auditable event chain. This guard prevents the bot from inventing a conclusion from old price or analyst data.',
  ].filter(Boolean);
  return [
    `🧠 THESIS NOT READY · ${ticker}`,
    `Live refresh completed in ${formatRunDuration(result.durationMs ?? 0)}. Fetched ${result.fetchedCount} observations from ${coverage?.successfulSources ?? 0}/${coverage?.expectedSources ?? 0} enabled sources.`,
    `Event processing: ${createdEvents} new canonical events · ${intelligence?.duplicateEventCount ?? 0} duplicates · ${intelligence?.storedOnlyCount ?? 0} stored-only · ${analyzedEvents} analyzed.`,
    'Why no thesis yet',
    ...reasons.map((reason) => `• ${reason}`),
    'What must happen next',
    ...nextSteps.map((step) => `• ${step}`),
    'More waiting would not by itself fix this run: it already waited for every selected source and bounded LLM attempt. The missing condition is usable, successfully analysed evidence—not a one-minute command limit.',
    `Next action: wait for material company news, a filing, guidance, or earnings evidence, then run /thesis ${ticker}. Use /health if source or LLM failures persist.`,
  ].join('\n\n');
};
