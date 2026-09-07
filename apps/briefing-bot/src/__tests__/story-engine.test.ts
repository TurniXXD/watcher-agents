import type { BriefingEvent, BriefingEventRepository } from '@watcher/core';
import { describe, expect, it, vi } from 'vitest';
import {
  clusterBriefingEvents,
  eventsDescribeSameStory,
} from '../story-clustering.js';
import { StoryEngine } from '../story-engine.js';

const event = (
  id: string,
  overrides: Partial<BriefingEvent> = {},
): BriefingEvent => ({
  id,
  watcherBot: 'stocks',
  externalEventId: id,
  detectedAt: '2026-09-06T05:00:00.000Z',
  createdAt: '2026-09-06T05:00:00.000Z',
  updatedAt: '2026-09-06T05:00:00.000Z',
  category: 'STOCK_CATALYST',
  title: 'Merck Phase III melanoma trial succeeds',
  summary: 'The trial met its primary endpoint.',
  importance: 90,
  novelty: 90,
  relevance: 85,
  urgency: 70,
  actionable: true,
  action: 'Review Merck before market open',
  entities: [{ type: 'company', name: 'Merck', ticker: 'MRK' }],
  tags: ['melanoma', 'phase-3'],
  sourceUrls: [`https://example.com/${id}`],
  confidence: 'HIGH',
  status: 'NEW',
  ...overrides,
});

describe('briefing story clustering', () => {
  it('combines one cross-domain event while preserving both perspectives', () => {
    const stock = event('stock-merck');
    const medical = event('medical-merck', {
      watcherBot: 'medical',
      category: 'MEDICAL_TRIAL',
      title: 'Positive Phase III personalized melanoma vaccine results',
      summary: 'The human Phase III evidence is clinically strong.',
      actionable: false,
    });

    expect(eventsDescribeSameStory(stock, medical)).toBe(true);
    const [cluster] = clusterBriefingEvents([stock, medical]);
    expect(cluster).toMatchObject({
      eventIds: ['medical-merck', 'stock-merck'],
      watcherBots: ['medical', 'stocks'],
      importance: 90,
      actionable: true,
    });
    expect(cluster?.perspectives).toEqual([
      {
        watcherBot: 'medical',
        category: 'MEDICAL_TRIAL',
        summary: 'The human Phase III evidence is clinically strong.',
        confidence: 'HIGH',
      },
      {
        watcherBot: 'stocks',
        category: 'STOCK_CATALYST',
        summary: 'The trial met its primary endpoint.',
        confidence: 'HIGH',
      },
    ]);
  });

  it('does not merge unrelated stories merely because a company matches', () => {
    const appointment = event('appointment', {
      title: 'Merck appoints a new chief financial officer',
      summary: 'A new finance chief starts next month.',
      tags: ['management'],
    });
    const trial = event('trial', {
      watcherBot: 'medical',
      category: 'MEDICAL_TRIAL',
      title: 'Positive Phase III melanoma vaccine results',
      tags: ['melanoma'],
    });

    expect(eventsDescribeSameStory(appointment, trial)).toBe(false);
    expect(clusterBriefingEvents([appointment, trial])).toHaveLength(2);
  });
});

describe('StoryEngine', () => {
  it('ranks useful stories and suppresses unchanged and minor resolutions', async () => {
    const developing = event('developing', {
      watcherBot: 'medical',
      category: 'MEDICAL_RESEARCH',
      title: 'Large human study reports a meaningful update',
      summary: 'The larger follow-up now confirms the original signal.',
      status: 'DEVELOPING',
      entities: [{ type: 'study', id: 'study-1', name: 'Study one' }],
      tags: ['follow-up'],
    });
    const unchanged = event('unchanged', {
      title: 'Unchanged earnings date',
      summary: 'The previously announced date remains unchanged.',
      status: 'UNCHANGED',
      entities: [{ type: 'company', name: 'Micron', ticker: 'MU' }],
      tags: ['earnings'],
    });
    const resolved = event('resolved', {
      title: 'Minor issue resolved',
      summary: 'A low-value operational issue is closed.',
      status: 'RESOLVED',
      importance: 40,
      entities: [{ type: 'company', name: 'Sandisk', ticker: 'SNDK' }],
      tags: ['operations'],
    });
    const developingId = clusterBriefingEvents([developing])[0]!.id;
    const list = vi.fn(async () => [unchanged, resolved, developing]);
    const repository: BriefingEventRepository = {
      save: vi.fn(),
      list,
    };
    const states = {
      list: vi.fn(async () => [
        {
          storyId: developingId,
          firstMentionedAt: '2026-09-05T05:00:00.000Z',
          lastMentionedAt: '2026-09-05T05:00:00.000Z',
          lastSummary: 'The first dataset suggested a possible signal.',
          importance: 75,
          status: 'NEW' as const,
        },
      ]),
    };
    const engine = new StoryEngine(repository, states);

    const result = await engine.collect({
      telegramChatId: 42n,
      subscriptions: ['stocks', 'medical'],
      periodStart: new Date('2026-09-05T05:00:00.000Z'),
      periodEnd: new Date('2026-09-06T06:00:00.000Z'),
    });

    expect(list).toHaveBeenCalledWith({
      watcherBots: ['stocks', 'medical'],
      detectedAfter: new Date('2026-09-05T05:00:00.000Z'),
      detectedThrough: new Date('2026-09-06T06:00:00.000Z'),
      detectedOrder: 'desc',
      limit: 1_000,
    });
    expect(result.stories).toMatchObject([
      {
        id: developingId,
        status: 'DEVELOPING',
        previouslyMentioned: true,
        previousSummary: 'The first dataset suggested a possible signal.',
      },
    ]);
    expect(result.metrics).toMatchObject({
      eventsRetrieved: 3,
      clustersCreated: 3,
      unchangedSuppressed: 1,
      resolvedSuppressed: 1,
      continuityStories: 1,
      selected: 1,
    });
  });

  it('does not query watcher events when every subscription is disabled', async () => {
    const list = vi.fn();
    const repository: BriefingEventRepository = {
      save: vi.fn(),
      list,
    };
    const engine = new StoryEngine(repository, { list: vi.fn(async () => []) });

    const result = await engine.collect({
      telegramChatId: 42n,
      subscriptions: [],
      periodStart: new Date('2026-09-05T05:00:00.000Z'),
      periodEnd: new Date('2026-09-06T05:00:00.000Z'),
    });

    expect(list).not.toHaveBeenCalled();
    expect(result.metrics.eventsRetrieved).toBe(0);
  });
});
