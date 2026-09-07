import { createHash } from 'node:crypto';
import type {
  BriefingEntity,
  BriefingEvent,
  BriefingEventStatus,
  WatcherBotId,
} from '@watcher/core';
import { briefingScore } from './story-ranking.js';
import type { BriefingStoryCluster, StoryPerspective } from './story-types.js';

const stopWords = new Set([
  'a',
  'an',
  'and',
  'at',
  'for',
  'from',
  'in',
  'is',
  'of',
  'on',
  'the',
  'to',
  'with',
]);

const relatedCategories = new Set([
  'MEDICAL_APPROVAL:STOCK_CATALYST',
  'MEDICAL_APPROVAL:STOCK_REGULATORY_EVENT',
  'MEDICAL_SAFETY:STOCK_THESIS_CHANGE',
  'MEDICAL_TRIAL:STOCK_CATALYST',
  'MEDICAL_TRIAL:STOCK_THESIS_CHANGE',
]);

const normalize = (value: string): string =>
  value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const tokens = (value: string): Set<string> =>
  new Set(
    normalize(value)
      .split(' ')
      .filter((token) => token.length > 1 && !stopWords.has(token)),
  );

const overlap = (left: Set<string>, right: Set<string>): number => {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  left.forEach((value) => {
    if (right.has(value)) shared += 1;
  });
  return shared / (left.size + right.size - shared);
};

const entityKeys = (event: BriefingEvent): Set<string> =>
  new Set(
    event.entities.flatMap((entity) => [
      ...(entity.ticker ? [`ticker:${entity.ticker.toLowerCase()}`] : []),
      ...(entity.id
        ? [`${entity.type.toLowerCase()}:id:${entity.id.toLowerCase()}`]
        : []),
      `${entity.type.toLowerCase()}:name:${normalize(entity.name)}`,
    ]),
  );

const normalizedUrls = (event: BriefingEvent): Set<string> =>
  new Set(
    event.sourceUrls.map((value) => {
      const url = new URL(value);
      url.hash = '';
      url.search = '';
      return url.toString().replace(/\/$/, '');
    }),
  );

const eventAt = (event: BriefingEvent): Date =>
  new Date(event.occurredAt ?? event.publishedAt ?? event.detectedAt);

const categoriesRelated = (left: string, right: string): boolean =>
  relatedCategories.has([left, right].sort().join(':'));

const directlyRelated = (left: BriefingEvent, right: BriefingEvent): boolean =>
  left.relatedEventIds?.includes(right.id) === true ||
  right.relatedEventIds?.includes(left.id) === true;

export const semanticPairKey = (leftId: string, rightId: string): string =>
  [leftId, rightId].sort().join('\u0000');

export const semanticRelationshipSupported = (
  left: BriefingEvent,
  right: BriefingEvent,
): boolean => {
  const sharesEntity = overlap(entityKeys(left), entityKeys(right)) > 0;
  const sameCategory = left.category === right.category;
  const relatedCategory = categoriesRelated(left.category, right.category);
  const relatedSource =
    left.watcherBot !== right.watcherBot &&
    Boolean(
      left.primarySource &&
      right.primarySource &&
      left.primarySource === right.primarySource,
    );
  return sharesEntity || sameCategory || relatedCategory || relatedSource;
};

export const eventsDescribeSameStory = (
  left: BriefingEvent,
  right: BriefingEvent,
): boolean => {
  if (left.id === right.id || directlyRelated(left, right)) return true;
  if (overlap(normalizedUrls(left), normalizedUrls(right)) > 0) return true;

  const hoursApart =
    Math.abs(eventAt(left).getTime() - eventAt(right).getTime()) / 3_600_000;
  if (hoursApart > 96) return false;

  const titleOverlap = overlap(tokens(left.title), tokens(right.title));
  const tagOverlap = overlap(
    new Set(left.tags.map(normalize)),
    new Set(right.tags.map(normalize)),
  );
  const sharesEntity = overlap(entityKeys(left), entityKeys(right)) > 0;
  if (left.watcherBot !== right.watcherBot) {
    return (
      (sharesEntity && (titleOverlap >= 0.18 || tagOverlap >= 0.25)) ||
      (sharesEntity &&
        categoriesRelated(left.category, right.category) &&
        titleOverlap >= 0.1) ||
      titleOverlap >= 0.6
    );
  }
  return sharesEntity && (titleOverlap >= 0.45 || tagOverlap >= 0.5);
};

const uniqueEntities = (events: readonly BriefingEvent[]): BriefingEntity[] => {
  const entities = new Map<string, BriefingEntity>();
  events
    .flatMap(({ entities: values }) => values)
    .forEach((entity) => {
      const key = entity.ticker
        ? `ticker:${entity.ticker}`
        : `${entity.type}:${entity.id ?? normalize(entity.name)}`;
      if (!entities.has(key)) entities.set(key, entity);
    });
  return [...entities.values()];
};

const aggregateStatus = (
  events: readonly BriefingEvent[],
): BriefingEventStatus => {
  const statuses = new Set(events.map(({ status }) => status));
  if (statuses.has('DEVELOPING')) return 'DEVELOPING';
  if (statuses.has('NEW')) return 'NEW';
  if (statuses.has('RESOLVED')) return 'RESOLVED';
  return 'UNCHANGED';
};

const stableStoryId = (events: readonly BriefingEvent[]): string => {
  const roots = events.flatMap((event) => [
    event.id,
    ...(event.relatedEventIds ?? []),
  ]);
  const root = [...new Set(roots)].sort()[0]!;
  return `story:${createHash('sha256').update(root).digest('hex').slice(0, 24)}`;
};

const maximum = (
  events: readonly BriefingEvent[],
  field: 'importance' | 'novelty' | 'relevance' | 'urgency',
): number => Math.max(...events.map((event) => event[field]));

const perspectiveFor = (
  events: readonly BriefingEvent[],
  watcherBot: WatcherBotId,
): StoryPerspective => {
  const event = events
    .filter((candidate) => candidate.watcherBot === watcherBot)
    .sort((left, right) => briefingScore(right) - briefingScore(left))[0]!;
  return {
    watcherBot,
    category: event.category,
    summary: event.summary,
    confidence: event.confidence,
  };
};

const buildCluster = (events: BriefingEvent[]): BriefingStoryCluster => {
  const ordered = [...events].sort(
    (left, right) =>
      briefingScore(right) - briefingScore(left) ||
      right.updatedAt.localeCompare(left.updatedAt),
  );
  const primary = ordered[0]!;
  const watcherBots = [
    ...new Set(events.map(({ watcherBot }) => watcherBot)),
  ].sort();
  const timestamps = events.map((event) => eventAt(event).toISOString()).sort();
  const cluster = {
    id: stableStoryId(events),
    eventIds: events.map(({ id }) => id).sort(),
    events: ordered,
    title: primary.title,
    summary: primary.summary,
    status: aggregateStatus(events),
    importance: maximum(events, 'importance'),
    novelty: maximum(events, 'novelty'),
    relevance: maximum(events, 'relevance'),
    urgency: maximum(events, 'urgency'),
    actionable: events.some(({ actionable }) => actionable),
    actionItems: [
      ...new Set(events.flatMap(({ action }) => (action ? [action] : []))),
    ],
    watcherBots,
    entities: uniqueEntities(events),
    sourceUrls: [...new Set(events.flatMap(({ sourceUrls }) => sourceUrls))],
    perspectives: watcherBots.map((watcherBot) =>
      perspectiveFor(events, watcherBot),
    ),
    firstEventAt: timestamps[0]!,
    lastEventAt: timestamps.at(-1)!,
    previouslyMentioned: false,
  } satisfies Omit<BriefingStoryCluster, 'score'>;
  return { ...cluster, score: briefingScore(cluster) };
};

export const clusterBriefingEvents = (
  events: readonly BriefingEvent[],
  semanticPairs: ReadonlySet<string> = new Set(),
): BriefingStoryCluster[] => {
  const parents = events.map((_, index) => index);
  const root = (index: number): number => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]!]!;
      index = parents[index]!;
    }
    return index;
  };
  const join = (left: number, right: number): void => {
    const leftRoot = root(left);
    const rightRoot = root(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };
  events.forEach((left, leftIndex) => {
    events.slice(leftIndex + 1).forEach((right, offset) => {
      if (
        eventsDescribeSameStory(left, right) ||
        semanticPairs.has(semanticPairKey(left.id, right.id))
      ) {
        join(leftIndex, leftIndex + offset + 1);
      }
    });
  });
  const groups = new Map<number, BriefingEvent[]>();
  events.forEach((event, index) => {
    const group = groups.get(root(index)) ?? [];
    group.push(event);
    groups.set(root(index), group);
  });
  return [...groups.values()].map(buildCluster);
};
