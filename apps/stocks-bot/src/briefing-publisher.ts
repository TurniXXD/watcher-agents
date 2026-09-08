import {
  briefingConfidenceFromScore,
  stockAnalysisSchema,
  type BriefingEvent,
  type BriefingEventRepository,
  type PipelineResult,
  type RunEventSummary,
  type WatcherLogger,
} from '@watcher/core';
import type { EarningsReminderCandidate } from '@watcher/database';

const stockCategory = (eventType: string): BriefingEvent['category'] => {
  if (eventType === 'EARNINGS' || eventType === 'GUIDANCE') {
    return 'STOCK_EARNINGS';
  }
  if (
    eventType === 'INSIDER_TRANSACTION' ||
    eventType === 'CONGRESSIONAL_TRANSACTION' ||
    eventType === 'INSTITUTIONAL_POSITIONING'
  ) {
    return 'STOCK_INSIDER_ACTIVITY';
  }
  if (
    eventType === 'PRICE_ANOMALY' ||
    eventType === 'VOLUME_ANOMALY' ||
    eventType === 'OPTIONS_ANOMALY' ||
    eventType === 'OFF_EXCHANGE_ANOMALY' ||
    eventType === 'SHORT_INTEREST_CHANGE'
  ) {
    return 'STOCK_PRICE_ANOMALY';
  }
  if (
    eventType === 'REGULATORY' ||
    eventType === 'FDA_DECISION' ||
    eventType === 'LEGAL'
  ) {
    return 'STOCK_REGULATORY_EVENT';
  }
  return 'STOCK_CATALYST';
};

const materialityScore = (materiality: RunEventSummary['materiality']) =>
  ({ NONE: 10, LOW: 30, MEDIUM: 55, HIGH: 80, EXTREME: 100 })[materiality];

const isMeaningful = (event: RunEventSummary): boolean =>
  event.decision === 'ANALYZE' &&
  (event.materiality === 'HIGH' ||
    event.materiality === 'EXTREME' ||
    event.action === 'FULL_ANALYSIS' ||
    event.action === 'IMMEDIATE_ANALYSIS');

const itemTicker = (metadata: Record<string, unknown>): string | undefined =>
  typeof metadata.symbol === 'string'
    ? metadata.symbol.toUpperCase()
    : undefined;

const companyName = (
  ticker: string,
  metadata: Record<string, unknown>,
): string => {
  const target = metadata.target;
  if (typeof target !== 'string') return ticker;
  const separator = target.indexOf(' — ');
  return separator === -1 ? target : target.slice(separator + 3);
};

const DAY_MS = 24 * 60 * 60_000;

const localDateSerial = (date: Date, timeZone: string): number => {
  try {
    const values = localDateParts(date, timeZone);
    return Date.UTC(values.year, values.month - 1, values.day) / DAY_MS;
  } catch {
    return (
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) /
      DAY_MS
    );
  }
};

const localDateParts = (
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number } => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter(
        ({ type }) => type === 'year' || type === 'month' || type === 'day',
      )
      .map(({ type, value }) => [type, Number(value)]),
  );
  if (!values.year || !values.month || !values.day) {
    throw new Error('Missing local date part');
  }
  return values as { year: number; month: number; day: number };
};

const localDateLabel = (date: Date, timeZone: string): string => {
  const { year, month, day } = localDateParts(date, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const reminderOffsetLabel = (daysUntil: 1 | 7): string =>
  daysUntil === 1 ? 'tomorrow' : 'in one week';

export const earningsReminderBriefingEvents = (
  catalysts: readonly EarningsReminderCandidate[],
  now = new Date(),
  timeZone = 'Europe/Prague',
): BriefingEvent[] => {
  const today = localDateSerial(now, timeZone);
  const timestamp = now.toISOString();
  return catalysts.flatMap((catalyst) => {
    const daysUntil = localDateSerial(catalyst.expectedStart, timeZone) - today;
    if (daysUntil !== 1 && daysUntil !== 7) return [];
    const offset = daysUntil;
    const earningsDate = localDateLabel(catalyst.expectedStart, timeZone);
    const label = catalyst.companyName
      ? `${catalyst.ticker} — ${catalyst.companyName}`
      : catalyst.ticker;
    const reminderId = `earnings-reminder:${catalyst.ticker}:${earningsDate}:${offset}d`;
    return [
      {
        id: `stocks:${reminderId}`,
        watcherBot: 'stocks',
        externalEventId: reminderId,
        occurredAt: catalyst.expectedStart.toISOString(),
        detectedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
        category: 'STOCK_EARNINGS',
        subcategory: 'EARNINGS_REMINDER',
        title: `${label} earnings report ${reminderOffsetLabel(offset)}`,
        summary: `${label} has a confirmed quarterly earnings report date on ${earningsDate}. This is a ${offset === 1 ? 'day-before' : 'week-before'} reminder to review position size, expectations, guidance risk, and whether the setup still fits the current thesis.`,
        importance: offset === 1 ? 75 : 65,
        novelty: offset === 1 ? 80 : 65,
        relevance: 100,
        urgency: offset === 1 ? 85 : 60,
        actionable: true,
        action: `Review ${catalyst.ticker} earnings exposure ${reminderOffsetLabel(offset)}`,
        entities: [
          {
            type: 'company',
            name: catalyst.companyName ?? catalyst.ticker,
            ticker: catalyst.ticker,
          },
        ],
        tags: ['EARNINGS', 'EARNINGS_REMINDER', `${offset}D_BEFORE`],
        sourceUrls: catalyst.sourceUrl ? [catalyst.sourceUrl] : [],
        primarySource: catalyst.source ?? 'CATALYST',
        confidence: catalyst.exactDateKnown ? 'HIGH' : 'MEDIUM',
        status: 'NEW',
        deduplicationKey: `stocks:${reminderId}`,
        relatedEventIds: [catalyst.id],
        metadata: {
          reminderKind: 'EARNINGS_REPORT',
          daysUntil: offset,
          earningsDate,
          catalystId: catalyst.id,
          catalystDescription: catalyst.description,
          impact: catalyst.impact,
        },
      },
    ];
  });
};

export const stockBriefingEvents = (
  result: PipelineResult,
  now = new Date(),
): BriefingEvent[] =>
  (result.intelligence?.events ?? []).flatMap((event) => {
    if (!isMeaningful(event)) return [];
    const analyzed = result.analyses.find(
      ({ item, outcome }) =>
        outcome.status === 'SUCCESS' &&
        itemTicker(item.metadata) === event.ticker,
    );
    if (!analyzed || analyzed.outcome.status !== 'SUCCESS') return [];
    const analysis = stockAnalysisSchema.safeParse(analyzed.outcome.result);
    if (!analysis.success) return [];
    const timestamp = now.toISOString();
    const sourceDate = analyzed.item.eventAt ?? analyzed.item.publishedAt;
    const urgency = Math.max(
      materialityScore(event.materiality),
      event.action === 'IMMEDIATE_ANALYSIS' ? 100 : 0,
    );
    return [
      {
        id: `stocks:${event.eventId}`,
        watcherBot: 'stocks',
        externalEventId: event.eventId,
        ...(sourceDate ? { occurredAt: sourceDate.toISOString() } : {}),
        ...(analyzed.item.publishedAt
          ? { publishedAt: analyzed.item.publishedAt.toISOString() }
          : {}),
        detectedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
        category: stockCategory(event.eventType),
        subcategory: event.eventType,
        title: event.title.slice(0, 500),
        summary: analysis.data.summary.slice(0, 10_000),
        importance: Math.max(
          materialityScore(event.materiality),
          analysis.data.importance * 10,
        ),
        novelty: 100,
        relevance: 100,
        urgency,
        actionable:
          event.action === 'FULL_ANALYSIS' ||
          event.action === 'IMMEDIATE_ANALYSIS',
        ...(event.action === 'FULL_ANALYSIS' ||
        event.action === 'IMMEDIATE_ANALYSIS'
          ? { action: `Review ${event.ticker} before the next market session` }
          : {}),
        entities: [
          {
            type: 'company',
            name: companyName(event.ticker, analyzed.item.metadata),
            ticker: event.ticker,
          },
        ],
        tags: [
          ...(event.eventTypes ?? [event.eventType]),
          ...(event.direction ? [event.direction] : []),
        ],
        sourceUrls: [analyzed.item.url],
        primarySource: analyzed.item.source,
        confidence: briefingConfidenceFromScore(analysis.data.confidence),
        status: 'NEW',
        deduplicationKey: `stocks:${event.eventId}`,
        relatedEventIds: [event.eventId],
        metadata: {
          materiality: event.materiality,
          sourceAction: event.action,
          decision: event.decision,
          ...(event.direction ? { direction: event.direction } : {}),
        },
      },
    ];
  });

export const publishStockBriefingEvents = async (
  repository: BriefingEventRepository,
  result: PipelineResult,
  logger?: WatcherLogger,
  now = new Date(),
): Promise<{ published: number; failed: number }> => {
  const events = stockBriefingEvents(result, now);
  const settled = await Promise.allSettled(
    events.map((event) => repository.save(event)),
  );
  settled.forEach((outcome, index) => {
    if (outcome.status === 'rejected') {
      logger?.error(
        { briefingEventId: events[index]?.id, err: outcome.reason },
        'Stock briefing event publication failed',
      );
    }
  });
  return {
    published: settled.filter(({ status }) => status === 'fulfilled').length,
    failed: settled.filter(({ status }) => status === 'rejected').length,
  };
};

export const publishEarningsReminderBriefingEvents = async (
  repository: BriefingEventRepository,
  catalysts: readonly EarningsReminderCandidate[],
  logger?: WatcherLogger,
  now = new Date(),
  timeZone = 'Europe/Prague',
): Promise<{ published: number; failed: number }> => {
  const events = earningsReminderBriefingEvents(catalysts, now, timeZone);
  const settled = await Promise.allSettled(
    events.map((event) => repository.save(event)),
  );
  settled.forEach((outcome, index) => {
    if (outcome.status === 'rejected') {
      logger?.error(
        { briefingEventId: events[index]?.id, err: outcome.reason },
        'Earnings reminder briefing event publication failed',
      );
    }
  });
  return {
    published: settled.filter(({ status }) => status === 'fulfilled').length,
    failed: settled.filter(({ status }) => status === 'rejected').length,
  };
};
