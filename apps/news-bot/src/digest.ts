import { newsAnalysisSchema, type PipelineResult } from '@watcher/core';
import { formatRunDuration, htmlText, sourceLink } from '@watcher/telegram';

const scopeLabel = (scope: unknown): string =>
  scope === 'CZECH' ? '🇨🇿 Czech' : '🌍 Global';

const failures = (result: PipelineResult): string =>
  result.sourceFailures.length === 0
    ? ''
    : `\n\n⚠️ <b>Feed errors</b>\n${result.sourceFailures
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

export const renderNewsDigest = (result: PipelineResult): string => {
  const sections = result.analyses.flatMap(({ item, outcome }) => {
    if (outcome.status !== 'SUCCESS') return [];
    const analysis = newsAnalysisSchema.safeParse(outcome.result);
    if (!analysis.success) return [];
    const feedName =
      typeof item.metadata.feedName === 'string'
        ? item.metadata.feedName
        : item.source;
    return [
      [
        `${scopeLabel(item.metadata.scope)} · <b>${htmlText(analysis.data.category, 50)}</b>`,
        `<b>${htmlText(analysis.data.title, 500)}</b>`,
        `⭐ <b>Importance:</b> ${analysis.data.importance}/10 · 🎯 <b>Relevance:</b> ${analysis.data.relevance}/10`,
        `📝 ${htmlText(analysis.data.summary, 1_500)}`,
        analysis.data.keyFacts.length
          ? `🔑 <b>Key facts</b>\n${analysis.data.keyFacts
              .slice(0, 6)
              .map((fact) => `• ${htmlText(fact, 400)}`)
              .join('\n')}`
          : '',
        `💡 <b>Why it matters</b>\n${htmlText(analysis.data.whyItMatters, 800)}`,
        `🔗 <b>Source:</b> ${sourceLink(feedName, item.url)}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    ];
  });
  const coverage = result.dataCoverage
    ? `📡 <b>Data coverage:</b> ${result.dataCoverage.percentage}% (${result.dataCoverage.successfulSources}/${result.dataCoverage.expectedSources} feeds)`
    : '';
  return [
    '🗞 <b>NEWS WATCHER</b>',
    `⏱ <b>Run time:</b> ${formatRunDuration(result.durationMs ?? 0)}`,
    coverage,
    sections.join('\n\n──────────\n\n'),
  ]
    .filter(Boolean)
    .join('\n\n')
    .concat(analysisFailures(result))
    .concat(failures(result))
    .trim();
};
