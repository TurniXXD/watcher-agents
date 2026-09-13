import {
  briefingEventSchema,
  type BriefingEventRepository,
  type PipelineResult,
} from '@watcher/core';
import { describe, expect, it, vi } from 'vitest';
import {
  newsBriefingEvents,
  publishNewsBriefingEvents,
} from '../briefing-publisher.js';

const result = (
  importance = 9,
  relevance = 8,
  category: 'POLITICS' | 'SPORT' = 'POLITICS',
  scope: 'CZECH' | 'GLOBAL' = 'CZECH',
): PipelineResult => ({
  fetchedCount: 1,
  newItemCount: 1,
  analyzedCount: 1,
  failedAnalysisCount: 0,
  sourceFailures: [],
  analyses: [
    {
      item: {
        id: 'NEWS_RSS_CZECH:https://example.com/story',
        source: 'NEWS_RSS_CZECH',
        externalId: 'https://example.com/story',
        title: 'Election result changes coalition talks',
        url: 'https://example.com/story',
        publishedAt: new Date('2026-09-07T05:00:00.000Z'),
        content: 'The election result changed the expected coalition talks.',
        metadata: { scope, feedName: 'Example News' },
      },
      outcome: {
        status: 'SUCCESS',
        result: {
          title: 'Election result changes coalition talks',
          summary: 'The result materially changed the coalition outlook.',
          importance,
          relevance,
          category,
          keyFacts: ['Coalition talks changed'],
          whyItMatters: 'It affects the likely next government.',
          entities: ['Czech government'],
          confidence: 0.9,
        },
      },
    },
  ],
});

describe('news briefing publisher', () => {
  it('publishes significant news with its profile and provenance', () => {
    const events = newsBriefingEvents(
      result(),
      new Date('2026-09-07T06:00:00.000Z'),
    );
    expect(events).toHaveLength(1);
    expect(briefingEventSchema.parse(events[0])).toMatchObject({
      watcherBot: 'news',
      category: 'NEWS_POLITICS',
      subcategory: 'CZECH',
      importance: 90,
      relevance: 80,
      primarySource: 'Example News',
    });
  });

  it('suppresses low-value stories and isolates publication failures', async () => {
    expect(newsBriefingEvents(result(6))).toHaveLength(0);
    const repository: BriefingEventRepository = {
      save: vi.fn(async () => Promise.reject(new Error('unavailable'))),
      list: vi.fn(async () => []),
    };
    await expect(
      publishNewsBriefingEvents(repository, result()),
    ).resolves.toEqual({ published: 0, failed: 1 });
  });

  it('does not publish disabled Czech or Global sport to briefings', () => {
    const preferences = [
      { scope: 'CZECH' as const, category: 'SPORT' as const, enabled: false },
      { scope: 'GLOBAL' as const, category: 'SPORT' as const, enabled: false },
    ];

    expect(
      newsBriefingEvents(
        result(10, 10, 'SPORT', 'CZECH'),
        new Date(),
        preferences,
      ),
    ).toEqual([]);
    expect(
      newsBriefingEvents(
        result(10, 10, 'SPORT', 'GLOBAL'),
        new Date(),
        preferences,
      ),
    ).toEqual([]);
  });
});
