import { createHash } from 'node:crypto';
import {
  briefingConfidenceFromScore,
  isNewsCategoryEnabled,
  newsAnalysisSchema,
  type BriefingEvent,
  type BriefingEventRepository,
  type NewsCategoryPreference,
  type PipelineResult,
  type WatcherLogger,
} from '@watcher/core';

const eventIdentity = (source: string, externalId: string): string =>
  createHash('sha256').update(`${source}\u0000${externalId}`).digest('hex');

const scopeEntity = (scope: unknown): string =>
  scope === 'CZECH' ? 'Czechia' : 'Global';

export const newsBriefingEvents = (
  result: PipelineResult,
  now = new Date(),
  categoryPreferences: readonly NewsCategoryPreference[] = [],
): BriefingEvent[] =>
  result.analyses.flatMap(({ item, outcome }) => {
    if (outcome.status !== 'SUCCESS') return [];
    const analysis = newsAnalysisSchema.safeParse(outcome.result);
    if (!analysis.success) return [];
    if (analysis.data.importance < 7 || analysis.data.relevance < 6) return [];

    const scope = item.metadata.scope === 'CZECH' ? 'CZECH' : 'GLOBAL';
    if (
      !isNewsCategoryEnabled(categoryPreferences, scope, analysis.data.category)
    ) {
      return [];
    }

    const identity = eventIdentity(item.source, item.externalId);
    const timestamp = now.toISOString();
    return [
      {
        id: `news:${identity}`,
        watcherBot: 'news',
        externalEventId: identity,
        ...(item.eventAt ? { occurredAt: item.eventAt.toISOString() } : {}),
        ...(item.publishedAt
          ? { publishedAt: item.publishedAt.toISOString() }
          : {}),
        detectedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
        category: `NEWS_${analysis.data.category}`,
        subcategory: scope,
        title: analysis.data.title.slice(0, 500),
        summary: analysis.data.summary.slice(0, 10_000),
        importance: analysis.data.importance * 10,
        novelty: 100,
        relevance: analysis.data.relevance * 10,
        urgency: analysis.data.importance >= 9 ? 80 : 50,
        actionable: false,
        entities: [scopeEntity(scope), ...analysis.data.entities]
          .filter((name, index, all) => name && all.indexOf(name) === index)
          .slice(0, 100)
          .map((name) => ({ type: 'news_entity', name: name.slice(0, 300) })),
        tags: [scope, analysis.data.category],
        sourceUrls: [item.url],
        primarySource:
          typeof item.metadata.feedName === 'string'
            ? item.metadata.feedName.slice(0, 200)
            : item.source,
        confidence: briefingConfidenceFromScore(analysis.data.confidence),
        status: 'NEW',
        deduplicationKey: `news:${identity}`,
        relatedEventIds: [],
        metadata: {
          scope,
          keyFacts: analysis.data.keyFacts,
          whyItMatters: analysis.data.whyItMatters,
        },
      },
    ];
  });

export const publishNewsBriefingEvents = async (
  repository: BriefingEventRepository,
  result: PipelineResult,
  logger?: WatcherLogger,
  now = new Date(),
  categoryPreferences: readonly NewsCategoryPreference[] = [],
): Promise<{ published: number; failed: number }> => {
  const events = newsBriefingEvents(result, now, categoryPreferences);
  const settled = await Promise.allSettled(
    events.map((event) => repository.save(event)),
  );
  settled.forEach((outcome, index) => {
    if (outcome.status === 'rejected') {
      logger?.error(
        { briefingEventId: events[index]?.id, err: outcome.reason },
        'News briefing event publication failed',
      );
    }
  });
  return {
    published: settled.filter(({ status }) => status === 'fulfilled').length,
    failed: settled.filter(({ status }) => status === 'rejected').length,
  };
};
