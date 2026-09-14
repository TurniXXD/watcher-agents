import { publicationAnalysisSchema, type PipelineResult } from '@watcher/core';
import { renderPublicationDigest } from '@watcher/telegram';

/** Publication delivery is a high-signal alert channel, not a paper feed. */
export const MAXIMUM_HIGH_IMPACT_PUBLICATIONS_PER_RUN = 3;
export const MINIMUM_HIGH_IMPACT_PUBLICATION_IMPORTANCE = 9;
export const MINIMUM_HIGH_IMPACT_PUBLICATION_RELEVANCE = 8;

const publicationScores = (
  entry: PipelineResult['analyses'][number],
): { importance: number; relevance: number } => {
  if (entry.outcome.status !== 'SUCCESS') {
    return { importance: 0, relevance: 0 };
  }
  const analysis = publicationAnalysisSchema.safeParse(entry.outcome.result);
  return analysis.success
    ? {
        importance: analysis.data.importance,
        relevance: analysis.data.relevance,
      }
    : { importance: 0, relevance: 0 };
};

export const selectHighImpactPublicationAnalyses = (
  result: PipelineResult,
): PipelineResult['analyses'] =>
  result.analyses
    .flatMap((entry) => {
      if (entry.outcome.status !== 'SUCCESS') return [];
      const analysis = publicationAnalysisSchema.safeParse(
        entry.outcome.result,
      );
      if (!analysis.success) return [];
      return analysis.data.importance >=
        MINIMUM_HIGH_IMPACT_PUBLICATION_IMPORTANCE &&
        analysis.data.relevance >= MINIMUM_HIGH_IMPACT_PUBLICATION_RELEVANCE
        ? [entry]
        : [];
    })
    .sort((left, right) => {
      const leftAnalysis = publicationScores(left);
      const rightAnalysis = publicationScores(right);
      return (
        rightAnalysis.importance +
          rightAnalysis.relevance -
          (leftAnalysis.importance + leftAnalysis.relevance) ||
        rightAnalysis.importance - leftAnalysis.importance ||
        (right.item.publishedAt?.getTime() ?? 0) -
          (left.item.publishedAt?.getTime() ?? 0)
      );
    })
    .slice(0, MAXIMUM_HIGH_IMPACT_PUBLICATIONS_PER_RUN);

export const hasHighImpactPublicationDigest = (
  result: PipelineResult,
): boolean => selectHighImpactPublicationAnalyses(result).length > 0;

export const highImpactPublicationResult = (
  result: PipelineResult,
): PipelineResult => {
  const analyses = selectHighImpactPublicationAnalyses(result);
  return { ...result, analyses, analyzedCount: analyses.length };
};

export const renderHighImpactPublicationDigest = (
  result: PipelineResult,
): string =>
  renderPublicationDigest(highImpactPublicationResult(result)).replace(
    '🧬 <b>PUBLICATIONS WATCHER</b>',
    '🧬 <b>PUBLICATIONS WATCHER · HIGH IMPACT</b>',
  );
