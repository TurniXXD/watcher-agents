import type { BriefingWatcherHealthRecord } from '@watcher/database';
import { describe, expect, it } from 'vitest';
import {
  calculateBriefingCoverage,
  calculateWatcherNoise,
} from '../briefing-observability.js';
import type {
  BriefingStoryCluster,
  StoryEngineMetrics,
} from '../story-types.js';

const health = (
  watcherBot: 'stocks' | 'medical',
  status: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE',
  lastRunAt = '2026-09-06T05:00:00.000Z',
): BriefingWatcherHealthRecord => ({
  watcherBot,
  status,
  lastRunAt,
  eventsEmitted: 0,
  failedEventPublications: 0,
  sourceFailures: 0,
});

describe('briefing observability', () => {
  it('distinguishes stale watcher output from missing data', () => {
    expect(
      calculateBriefingCoverage({
        subscriptions: ['stocks', 'medical'],
        watcherHealth: [
          health('stocks', 'HEALTHY'),
          health('medical', 'HEALTHY', '2026-09-01T05:00:00.000Z'),
        ],
        weather: 'AVAILABLE',
        calendar: 'DISABLED',
        now: new Date('2026-09-06T06:00:00.000Z'),
      }),
    ).toMatchObject({
      percentage: 83,
      components: [
        { id: 'stocks', status: 'HEALTHY' },
        { id: 'medical', status: 'STALE' },
        { id: 'weather', status: 'AVAILABLE' },
      ],
    });
  });

  it('does not penalize a briefing when every optional input is disabled', () => {
    expect(
      calculateBriefingCoverage({
        subscriptions: [],
        watcherHealth: [],
        weather: 'DISABLED',
        calendar: 'DISABLED',
        now: new Date(),
      }).percentage,
    ).toBe(100);
  });

  it('tracks per-watcher selection and flags high-volume low-value output', () => {
    const metrics: StoryEngineMetrics = {
      eventsRetrieved: 30,
      clustersCreated: 25,
      duplicateReduction: 5,
      unchangedSuppressed: 2,
      resolvedSuppressed: 0,
      continuityStories: 0,
      selected: 23,
      eventsByWatcher: { stocks: 25, medical: 5, news: 0, 'mu-clubs': 0 },
      duplicateReductionByWatcher: {
        stocks: 5,
        medical: 0,
        news: 0,
        'mu-clubs': 0,
      },
    };
    const stories = [
      {
        events: [
          { id: 'stock-1', watcherBot: 'stocks' },
          { id: 'medical-1', watcherBot: 'medical' },
        ],
      },
    ] as BriefingStoryCluster[];

    expect(calculateWatcherNoise(metrics, stories)).toEqual({
      stocks: {
        eventsEmitted: 25,
        eventsSelected: 1,
        eventsOmitted: 24,
        selectionRate: 4,
        duplicateRate: 20,
        flaggedForTuning: true,
      },
      medical: {
        eventsEmitted: 5,
        eventsSelected: 1,
        eventsOmitted: 4,
        selectionRate: 20,
        duplicateRate: 0,
        flaggedForTuning: false,
      },
      news: {
        eventsEmitted: 0,
        eventsSelected: 0,
        eventsOmitted: 0,
        selectionRate: 0,
        duplicateRate: 0,
        flaggedForTuning: false,
      },
      'mu-clubs': {
        eventsEmitted: 0,
        eventsSelected: 0,
        eventsOmitted: 0,
        selectionRate: 0,
        duplicateRate: 0,
        flaggedForTuning: false,
      },
    });
  });
});
