import type { BriefingEvent, BriefingEventRepository } from '@watcher/core';
import { describe, expect, it, vi } from 'vitest';
import {
  clusterBriefingEvents,
  eventsDescribeSameStory,
} from '../story-clustering.js';
import { StoryEngine } from '../story-engine.js';
import { SemanticStoryMatcher } from '../semantic-story-matcher.js';

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

const immediateResourceLease = {
  withExclusiveLease: <T>(
    resource: string,
    operation: () => Promise<T>,
    timeoutMs?: number,
  ): Promise<T> => {
    void resource;
    void timeoutMs;
    return operation();
  },
};

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

describe('SemanticStoryMatcher', () => {
  it('accepts a high-similarity cross-language pair with a shared ticker', async () => {
    const left = event('english', {
      title: 'Merck reports successful melanoma trial results',
    });
    const right = event('czech', {
      watcherBot: 'medical',
      category: 'MEDICAL_TRIAL',
      title: 'Studie melanomu společnosti Merck uspěla',
    });
    const store = {
      listEmbeddingStates: vi.fn(async () => []),
      saveEmbedding: vi.fn(async () => undefined),
      findSemanticPairs: vi.fn(async () => [
        {
          leftEventId: left.id,
          rightEventId: right.id,
          similarity: 0.91,
        },
      ]),
    };
    const matcher = new SemanticStoryMatcher(
      'embed-model',
      {
        embed: vi.fn(async () => [
          [1, 0],
          [0.9, 0.1],
        ]),
      },
      store,
      immediateResourceLease,
    );

    const pairs = await matcher.matchingPairs([left, right]);

    expect(pairs.size).toBe(1);
    expect(store.saveEmbedding).toHaveBeenCalledTimes(2);
    expect(clusterBriefingEvents([left, right], pairs)).toHaveLength(1);
  });

  it('rejects semantic similarity without supporting entities, categories, or sources', async () => {
    const left = event('left', {
      category: 'STOCK_MANAGEMENT',
      entities: [{ type: 'company', name: 'Merck', ticker: 'MRK' }],
    });
    const right = event('right', {
      watcherBot: 'news',
      category: 'CLIMATE',
      entities: [{ type: 'place', name: 'Prague' }],
    });
    const matcher = new SemanticStoryMatcher(
      'embed-model',
      { embed: vi.fn(async () => [[1], [1]]) },
      {
        listEmbeddingStates: vi.fn(async () => []),
        saveEmbedding: vi.fn(async () => undefined),
        findSemanticPairs: vi.fn(async () => [
          {
            leftEventId: left.id,
            rightEventId: right.id,
            similarity: 0.99,
          },
        ]),
      },
      immediateResourceLease,
    );

    await expect(matcher.matchingPairs([left, right])).resolves.toHaveProperty(
      'size',
      0,
    );
  });

  it('uses semantic evidence instead of broad News profile tags for cross-publisher reports', async () => {
    const left = event('irozhlas-energy-package', {
      watcherBot: 'news',
      category: 'NEWS_POLITICS',
      title: 'Cabinet approves a new energy security package',
      summary: 'The Czech cabinet approved measures for energy security.',
      entities: [
        { type: 'news_entity', name: 'Czechia' },
        { type: 'news_entity', name: 'Czech cabinet' },
      ],
      tags: ['CZECH', 'POLITICS'],
      primarySource: 'iROZHLAS',
    });
    const right = event('ct24-energy-package', {
      watcherBot: 'news',
      category: 'NEWS_POLITICS',
      title: 'Vlada schvalila soubor opatreni pro energetickou bezpecnost',
      summary: 'Opatreni maji posilit energetickou bezpecnost Ceska.',
      entities: [
        { type: 'news_entity', name: 'Czechia' },
        { type: 'news_entity', name: 'Czech government' },
      ],
      tags: ['CZECH', 'POLITICS'],
      primarySource: 'CT24',
    });

    expect(eventsDescribeSameStory(left, right)).toBe(false);

    const matcher = new SemanticStoryMatcher(
      'embed-model',
      {
        embed: vi.fn(async () => [
          [1, 0],
          [0.95, 0.05],
        ]),
      },
      {
        listEmbeddingStates: vi.fn(async () => []),
        saveEmbedding: vi.fn(async () => undefined),
        findSemanticPairs: vi.fn(async () => [
          {
            leftEventId: left.id,
            rightEventId: right.id,
            similarity: 0.95,
          },
        ]),
      },
      immediateResourceLease,
    );

    const pairs = await matcher.matchingPairs([left, right]);

    expect(pairs.size).toBe(1);
    expect(clusterBriefingEvents([left, right], pairs)).toHaveLength(1);
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

    const recap = await engine.collect({
      telegramChatId: 42n,
      subscriptions: ['stocks', 'medical'],
      periodStart: new Date('2026-09-05T22:00:00.000Z'),
      periodEnd: new Date('2026-09-06T20:00:00.000Z'),
      includePreviouslyMentioned: true,
    });

    expect(recap.stories.map(({ title }) => title)).toContain(
      'Unchanged earnings date',
    );
    expect(recap.metrics).toMatchObject({
      unchangedSuppressed: 0,
      resolvedSuppressed: 1,
      selected: 2,
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

  it('boosts configured priorities and reduces non-urgent muted topics', async () => {
    const priority = event('priority', {
      title: 'Micron memory outlook',
      summary: 'A modest Micron update.',
      importance: 50,
      urgency: 40,
      entities: [{ type: 'company', name: 'Micron', ticker: 'MU' }],
    });
    const muted = event('muted', {
      title: 'Football transfer report',
      summary: 'A high-scoring sports update.',
      category: 'NEWS_SPORT',
      importance: 70,
      urgency: 40,
      entities: [{ type: 'team', name: 'Example FC' }],
    });
    const repository: BriefingEventRepository = {
      save: vi.fn(),
      list: vi.fn(async () => [muted, priority]),
    };
    const engine = new StoryEngine(repository, {
      list: vi.fn(async () => []),
    });

    const result = await engine.collect({
      telegramChatId: 42n,
      subscriptions: ['stocks', 'news'],
      periodStart: new Date('2026-09-05T05:00:00.000Z'),
      periodEnd: new Date('2026-09-06T06:00:00.000Z'),
      priorityKeywords: ['Micron'],
      mutedKeywords: ['football'],
    });

    expect(result.stories.map(({ title }) => title)).toEqual([
      'Micron memory outlook',
      'Football transfer report',
    ]);
  });
});
