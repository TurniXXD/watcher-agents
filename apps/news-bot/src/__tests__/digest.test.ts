import type { PipelineResult } from '@watcher/core';
import { describe, expect, it } from 'vitest';
import { hasScheduledNewsDigest, renderNewsDigest } from '../digest.js';

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
      id: `NEWS:${index}`,
      source: 'NEWS_RSS_GLOBAL',
      externalId: String(index),
      title: `Source title ${index}`,
      url: `https://example.com/${index}`,
      publishedAt: new Date(
        `2026-09-11T${String(index).padStart(2, '0')}:00:00.000Z`,
      ),
      content: `Story ${index}`,
      metadata: { scope: 'GLOBAL', feedName: 'Example News' },
    },
    outcome: {
      status: 'SUCCESS' as const,
      result: {
        title: `Ranked story ${index}`,
        summary: `Summary ${index}`,
        importance,
        relevance,
        category: 'OTHER' as const,
        keyFacts: [],
        whyItMatters: `Impact ${index}`,
        entities: [],
        confidence: 0.8,
      },
    },
  })),
});

describe('news digest delivery policy', () => {
  it('limits scheduled delivery to ten significant and relevant stories', () => {
    const input = result([
      ...Array.from({ length: 12 }, () => ({ importance: 8, relevance: 7 })),
      { importance: 6, relevance: 10 },
      { importance: 10, relevance: 5 },
    ]);

    const digest = renderNewsDigest(input);

    expect(digest).toContain('Selected:</b> 10 of 14 new articles');
    expect(digest.match(/Ranked story/gu)).toHaveLength(10);
    expect(digest).not.toContain('Ranked story 12');
    expect(digest).not.toContain('Ranked story 13');
    expect(hasScheduledNewsDigest(input)).toBe(true);
  });

  it('keeps a scheduled run silent when no story meets both thresholds', () => {
    const input = result([
      { importance: 6, relevance: 10 },
      { importance: 10, relevance: 5 },
    ]);

    expect(hasScheduledNewsDigest(input)).toBe(false);
    expect(renderNewsDigest(input, true)).toContain(
      'Selected:</b> 2 of 2 new articles',
    );
  });
});
