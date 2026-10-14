import { describe, expect, it } from 'vitest';
import {
  assessMomentum,
  clusterTrendSignals,
  compareMarkets,
  scoreTrendOpportunity,
} from '../trends/analysis.js';
import type { TrendSignal } from '../trends/types.js';

const signal = (
  id: string,
  title: string,
  source: TrendSignal['source'],
  region: TrendSignal['region'],
): TrendSignal & { id: string } => ({
  id,
  externalId: id,
  source,
  sourceUrl: `https://example.com/${id}`,
  title,
  region,
  collectedAt: new Date('2026-10-14T05:00:00.000Z'),
  metrics: {},
});

describe('trend intelligence analysis', () => {
  it('clusters overlapping signals while preserving evidence', () => {
    const clusters = clusterTrendSignals([
      signal('1', 'AI phone agents for small business', 'REDDIT', 'US'),
      signal('2', 'AI phone agent automation for business', 'YOUTUBE', 'US'),
      signal('3', 'TypeScript runtime release', 'YOUTUBE', 'US'),
    ]);
    expect(clusters).toHaveLength(2);
    expect(
      clusters.find(({ signals }) => signals.length === 2)?.signals,
    ).toHaveLength(2);
  });

  it('never calculates growth from a single observation', () => {
    const momentum = assessMomentum(
      [
        {
          source: 'YOUTUBE',
          firstSeenAt: new Date('2026-10-14T00:00:00Z'),
          lastSeenAt: new Date('2026-10-14T00:00:00Z'),
          observations: [
            {
              observedAt: new Date('2026-10-14T00:00:00Z'),
              views: 100n,
              likes: null,
              comments: null,
              shares: null,
              searchInterest: null,
            },
          ],
        },
      ],
      new Date('2026-10-14T06:00:00Z'),
    );
    expect(momentum.stage).toBe('UNKNOWN');
    expect(momentum.growthPercent).toBeUndefined();
    expect(momentum.missingData).toContain(
      'At least two comparable observations',
    );
  });

  it('detects growth only from repeated comparable observations', () => {
    const observations = [
      {
        observedAt: new Date('2026-10-13T00:00:00Z'),
        views: 100n,
        likes: null,
        comments: null,
        shares: null,
        searchInterest: null,
      },
      {
        observedAt: new Date('2026-10-14T00:00:00Z'),
        views: 160n,
        likes: null,
        comments: null,
        shares: null,
        searchInterest: null,
      },
    ];
    const momentum = assessMomentum(
      [
        {
          source: 'YOUTUBE',
          firstSeenAt: new Date('2026-10-13T00:00:00Z'),
          lastSeenAt: new Date('2026-10-14T00:00:00Z'),
          observations,
        },
        {
          source: 'REDDIT',
          firstSeenAt: new Date('2026-10-13T00:00:00Z'),
          lastSeenAt: new Date('2026-10-14T00:00:00Z'),
          observations,
        },
      ],
      new Date('2026-10-14T06:00:00Z'),
    );
    expect(momentum.stage).toBe('RAPIDLY_GROWING');
    expect(momentum.growthPercent).toBe(60);
  });

  it('treats missing Czech data as uncertainty instead of absence', () => {
    const comparison = compareMarkets(
      [signal('1', 'Local AI agents', 'YOUTUBE', 'US')],
      true,
    );
    expect(comparison.status).toBe('UNCERTAIN');
    expect(comparison.explanation).toContain('not evidence');
  });

  it('scores opportunity separately from evidence confidence', () => {
    const candidate = clusterTrendSignals([
      signal('1', 'AI business workflow automation', 'YOUTUBE', 'US'),
    ])[0]!;
    const result = scoreTrendOpportunity({
      cluster: candidate,
      momentum: {
        stage: 'EARLY_EMERGING',
        observationCount: 1,
        independentSourceCount: 1,
        ageDays: 1,
        persistenceDays: 0,
        explanation: 'Limited',
        missingData: ['History'],
      },
      comparison: {
        status: 'EARLY_OPPORTUNITY',
        confidence: 40,
        explanation: 'Estimate',
        missingData: ['Czech evidence'],
        usEvidence: {},
        czEvidence: {},
      },
      focusTopics: ['AI integrations', 'business automation'],
      audiences: ['Czech business owners'],
      weights: {
        usMomentum: 25,
        czechOpportunity: 25,
        audienceRelevance: 20,
        businessPotential: 15,
        contentFeasibility: 10,
        evidenceQuality: 5,
      },
    });
    expect(result.score).toBeGreaterThan(60);
    expect(result.confidence).toBeLessThan(result.score);
    expect(result.missingData).toEqual(['History', 'Czech evidence']);
  });
});
