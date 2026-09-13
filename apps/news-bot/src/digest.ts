import {
  isNewsCategoryEnabled,
  newsAnalysisSchema,
  type NewsCategoryPreference,
  type NewsAnalysis,
  type PipelineResult,
  type WatchItem,
} from '@watcher/core';
import { formatRunDuration, htmlText, sourceLink } from '@watcher/telegram';

const maximumDeliveredStories = 10;
const scheduledMinimumImportance = 7;
const scheduledMinimumRelevance = 6;

type DigestStory = { item: WatchItem; analysis: NewsAnalysis };

export const selectNewsDigestStories = (
  result: PipelineResult,
  manual: boolean,
  categoryPreferences: readonly NewsCategoryPreference[] = [],
): DigestStory[] =>
  result.analyses
    .flatMap(({ item, outcome }): DigestStory[] => {
      if (outcome.status !== 'SUCCESS') return [];
      const analysis = newsAnalysisSchema.safeParse(outcome.result);
      if (!analysis.success) return [];
      const scope = item.metadata.scope === 'CZECH' ? 'CZECH' : 'GLOBAL';
      if (
        !isNewsCategoryEnabled(
          categoryPreferences,
          scope,
          analysis.data.category,
        )
      ) {
        return [];
      }
      if (
        !manual &&
        (analysis.data.importance < scheduledMinimumImportance ||
          analysis.data.relevance < scheduledMinimumRelevance)
      ) {
        return [];
      }
      return [{ item, analysis: analysis.data }];
    })
    .sort(
      (left, right) =>
        right.analysis.importance +
          right.analysis.relevance -
          (left.analysis.importance + left.analysis.relevance) ||
        right.analysis.importance - left.analysis.importance ||
        (right.item.publishedAt?.getTime() ?? 0) -
          (left.item.publishedAt?.getTime() ?? 0),
    )
    .slice(0, maximumDeliveredStories);

export const hasScheduledNewsDigest = (
  result: PipelineResult,
  categoryPreferences: readonly NewsCategoryPreference[] = [],
): boolean =>
  selectNewsDigestStories(result, false, categoryPreferences).length > 0;

const scopeLabel = (scope: unknown): string =>
  scope === 'CZECH' ? '🇨🇿 Czech' : '🌍 Global';

const failures = (result: PipelineResult): string =>
  result.sourceFailures.filter(
    ({ message }) => !/^RATE_LIMITED backoff active\b/iu.test(message),
  ).length === 0
    ? ''
    : `\n\n⚠️ <b>Feed errors</b>\n${result.sourceFailures
        .filter(
          ({ message }) => !/^RATE_LIMITED backoff active\b/iu.test(message),
        )
        .map(
          (failure) =>
            `• <b>${htmlText(failure.target, 300)}</b>\n  ${htmlText(failure.message, 600)}`,
        )
        .join('\n\n')}`;

const analysisFailures = (result: PipelineResult): string => {
  const failed = result.analyses.filter(
    ({ outcome }) => outcome.status === 'FAILED',
  );
  return failed.length === 0
    ? ''
    : `\n\n⚠️ <b>Analysis errors</b>\n${failed
        .slice(0, 5)
        .map(({ item, outcome }) => {
          const error = outcome.status === 'FAILED' ? outcome.error : '';
          return `• <b>${htmlText(item.title, 300)}</b>\n  ${htmlText(error, 600)}`;
        })
        .join('\n\n')}`;
};

export const renderNewsDigest = (
  result: PipelineResult,
  manual = false,
  categoryPreferences: readonly NewsCategoryPreference[] = [],
): string => {
  const stories = selectNewsDigestStories(result, manual, categoryPreferences);
  const sections = stories.map(({ item, analysis }) => {
    const feedName =
      typeof item.metadata.feedName === 'string'
        ? item.metadata.feedName
        : item.source;
    return [
      `${scopeLabel(item.metadata.scope)} · <b>${htmlText(analysis.category, 50)}</b>`,
      `<b>${htmlText(analysis.title, 500)}</b>`,
      `⭐ <b>Importance:</b> ${analysis.importance}/10 · 🎯 <b>Relevance:</b> ${analysis.relevance}/10`,
      `📝 ${htmlText(analysis.summary, 1_500)}`,
      analysis.keyFacts.length
        ? `🔑 <b>Key facts</b>\n${analysis.keyFacts
            .slice(0, 6)
            .map((fact) => `• ${htmlText(fact, 400)}`)
            .join('\n')}`
        : '',
      `💡 <b>Why it matters</b>\n${htmlText(analysis.whyItMatters, 800)}`,
      `🔗 <b>Source:</b> ${sourceLink(feedName, item.url)}`,
    ]
      .filter(Boolean)
      .join('\n\n');
  });
  const coverage = result.dataCoverage
    ? `📡 <b>Data coverage:</b> ${result.dataCoverage.percentage}% (${result.dataCoverage.successfulSources}/${result.dataCoverage.expectedSources} feeds)`
    : '';
  return [
    '🗞 <b>NEWS WATCHER</b>',
    `⏱ <b>Run time:</b> ${formatRunDuration(result.durationMs ?? 0)}`,
    coverage,
    `📰 <b>Selected:</b> ${stories.length} of ${result.newItemCount} new articles${manual ? '' : ` (importance ≥ ${scheduledMinimumImportance}, relevance ≥ ${scheduledMinimumRelevance})`}`,
    sections.join('\n\n──────────\n\n'),
  ]
    .filter(Boolean)
    .join('\n\n')
    .concat(analysisFailures(result))
    .concat(failures(result))
    .trim();
};
