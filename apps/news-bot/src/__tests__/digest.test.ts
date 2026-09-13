import type { PipelineResult } from '@watcher/core';
import { describe, expect, it } from 'vitest';
import { hasScheduledNewsDigest, renderNewsDigest } from '../digest.js';

const result = (
  scores: readonly {
    importance: number;
    relevance: number;
    category?: 'POLITICS' | 'SPORT' | 'OTHER';
    scope?: 'CZECH' | 'GLOBAL';
  }[],
): PipelineResult => ({
  durationMs: 1_000,
  fetchedCount: scores.length,
  newItemCount: scores.length,
  analyzedCount: scores.length,
  failedAnalysisCount: 0,
  sourceFailures: [],
  analyses: scores.map(
    (
      { importance, relevance, category = 'OTHER', scope = 'GLOBAL' },
      index,
    ) => ({
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
        metadata: { scope, feedName: 'Example News' },
      },
      outcome: {
        status: 'SUCCESS' as const,
        result: {
          title: `Ranked story ${index}`,
          summary: `Summary ${index}`,
          importance,
          relevance,
          category,
          keyFacts: [],
          whyItMatters: `Impact ${index}`,
          entities: [],
          confidence: 0.8,
        },
      },
    }),
  ),
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

  it('suppresses disabled sport in manual and scheduled digests', () => {
    const input = result([
      {
        importance: 10,
        relevance: 10,
        category: 'SPORT',
        scope: 'CZECH',
      },
      {
        importance: 10,
        relevance: 10,
        category: 'SPORT',
        scope: 'GLOBAL',
      },
      { importance: 8, relevance: 8, category: 'POLITICS' },
    ]);
    const preferences = [
      { scope: 'CZECH' as const, category: 'SPORT' as const, enabled: false },
      { scope: 'GLOBAL' as const, category: 'SPORT' as const, enabled: false },
    ];

    expect(renderNewsDigest(input, true, preferences)).toContain(
      'Selected:</b> 1 of 3 new articles',
    );
    expect(renderNewsDigest(input, true, preferences)).not.toContain(
      'Ranked story 0',
    );
    expect(renderNewsDigest(input, true, preferences)).not.toContain(
      'Ranked story 1',
    );
    expect(hasScheduledNewsDigest(input, preferences)).toBe(true);
  });

  it('does not repeat an expected provider rate-limit backoff as a feed error', () => {
    const input = result([{ importance: 8, relevance: 8 }]);
    input.sourceFailures = [
      {
        source: 'NEWS_GDELT',
        target: 'GLOBAL:built-in-gdelt',
        message: 'RATE_LIMITED backoff active until 2026-09-13T10:32:34.462Z',
      },
    ];

    expect(renderNewsDigest(input)).not.toContain('Feed errors');
    expect(renderNewsDigest(input)).not.toContain('RATE_LIMITED');
  });
});
