import type { PipelineResult } from '@watcher/core';
import { describe, expect, it } from 'vitest';
import {
  hasHighImpactPublicationDigest,
  highImpactPublicationResult,
  renderHighImpactPublicationDigest,
} from '../digest.js';

const result = (
  scores: readonly { importance: number; relevance: number }[],
): PipelineResult => ({
  durationMs: 1_000,
  fetchedCount: scores.length,
  newItemCount: scores.length,
  analyzedCount: scores.length,
  failedAnalysisCount: 0,
  sourceFailures: [],
  analyses: scores.map(({ importance, relevance }, index) => ({
    item: {
      id: `PUBMED:${index}`,
      source: 'PUBMED',
      externalId: String(index),
      title: `Paper ${index}`,
      url: `https://pubmed.ncbi.nlm.nih.gov/${index}/`,
      publishedAt: new Date(`2026-09-11T0${index}:00:00.000Z`),
      content: 'Publication content',
      metadata: { target: 'longevity' },
    },
    outcome: {
      status: 'SUCCESS' as const,
      result: {
        title: `Analysis ${index}`,
        summary: `Summary ${index}`,
        importance,
        relevance,
        keyFindings: [],
        methods: [],
        limitations: [],
        whyInteresting: `Why ${index}`,
        confidence: 0.8,
      },
    },
  })),
});

describe('high-impact publication delivery policy', () => {
  it('delivers at most three publications that meet both strict thresholds', () => {
    const input = result([
      { importance: 9, relevance: 8 },
      { importance: 9, relevance: 9 },
      { importance: 10, relevance: 8 },
      { importance: 9, relevance: 9 },
      { importance: 7, relevance: 10 },
      { importance: 10, relevance: 7 },
    ]);

    expect(hasHighImpactPublicationDigest(input)).toBe(true);
    expect(highImpactPublicationResult(input).analyses).toHaveLength(3);
    expect(renderHighImpactPublicationDigest(input)).toContain(
      'PUBLICATIONS WATCHER · HIGH IMPACT',
    );
    expect(renderHighImpactPublicationDigest(input)).not.toContain(
      'Analysis 4',
    );
    expect(renderHighImpactPublicationDigest(input)).not.toContain(
      'Analysis 5',
    );
  });

  it('does not create a digest for ordinary publications', () => {
    const input = result([{ importance: 8, relevance: 10 }]);

    expect(hasHighImpactPublicationDigest(input)).toBe(false);
    expect(highImpactPublicationResult(input).analyses).toHaveLength(0);
  });
});
