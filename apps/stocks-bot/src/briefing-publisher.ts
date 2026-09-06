import {
  briefingConfidenceFromScore,
  stockAnalysisSchema,
  type BriefingEvent,
  type BriefingEventRepository,
  type PipelineResult,
  type RunEventSummary,
  type WatcherLogger,
} from '@watcher/core';

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
        tags: [event.eventType, ...(event.direction ? [event.direction] : [])],
        sourceUrls: [analyzed.item.url],
        primarySource: analyzed.item.source,
        confidence: briefingConfidenceFromScore(analysis.data.confidence),
        status: 'NEW',
        deduplicationKey: `stocks:${event.eventId}`,
        relatedEventIds: [],
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
