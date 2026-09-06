import {
  briefingConfidenceFromScore,
  publicationAnalysisSchema,
  type BriefingEvent,
  type BriefingEventRepository,
  type PipelineResult,
  type WatchItem,
  type WatcherLogger,
} from '@watcher/core';

const medicalCategory = (item: WatchItem): BriefingEvent['category'] => {
  if (item.source === 'CLINICAL_TRIALS') return 'MEDICAL_TRIAL';
  if (item.source === 'FDA') {
    return /safety|warning|recall|adverse/i.test(item.title)
      ? 'MEDICAL_SAFETY'
      : 'MEDICAL_APPROVAL';
  }
  return 'MEDICAL_RESEARCH';
};

const uniqueEntityNames = (item: WatchItem): string[] => {
  const target = item.metadata.target;
  return [
    ...(item.entities ?? []),
    ...(typeof target === 'string' ? [target] : []),
  ].filter((value, index, all) => value && all.indexOf(value) === index);
};

export const medicalBriefingEvents = (
  result: PipelineResult,
  now = new Date(),
): BriefingEvent[] =>
  result.analyses.flatMap(({ item, outcome }) => {
    if (outcome.status !== 'SUCCESS') return [];
    const analysis = publicationAnalysisSchema.safeParse(outcome.result);
    if (!analysis.success) return [];
    if (analysis.data.importance < 7 || analysis.data.relevance < 7) return [];

    const timestamp = now.toISOString();
    const externalEventId = `${item.source}:${item.externalId}`;
    const category = medicalCategory(item);
    return [
      {
        id: `medical:${externalEventId}`,
        watcherBot: 'medical',
        externalEventId,
        ...(item.eventAt ? { occurredAt: item.eventAt.toISOString() } : {}),
        ...(item.publishedAt
          ? { publishedAt: item.publishedAt.toISOString() }
          : {}),
        detectedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
        category,
        subcategory: item.category ?? item.source,
        title: analysis.data.title.slice(0, 500),
        summary: analysis.data.summary.slice(0, 10_000),
        importance: analysis.data.importance * 10,
        novelty: 100,
        relevance: analysis.data.relevance * 10,
        urgency:
          category === 'MEDICAL_SAFETY'
            ? 90
            : category === 'MEDICAL_APPROVAL'
              ? 70
              : category === 'MEDICAL_TRIAL'
                ? 50
                : 30,
        actionable: false,
        entities: uniqueEntityNames(item).map((name) => ({
          type: 'topic',
          name: name.slice(0, 300),
        })),
        tags: [item.source, ...(item.category ? [item.category] : [])],
        sourceUrls: [item.url],
        primarySource: item.source,
        confidence: briefingConfidenceFromScore(analysis.data.confidence),
        status: 'NEW',
        deduplicationKey: `medical:${externalEventId}`,
        relatedEventIds: [],
        metadata: {
          keyFindings: analysis.data.keyFindings,
          methods: analysis.data.methods,
          limitations: analysis.data.limitations,
          whyInteresting: analysis.data.whyInteresting,
        },
      },
    ];
  });

export const publishMedicalBriefingEvents = async (
  repository: BriefingEventRepository,
  result: PipelineResult,
  logger?: WatcherLogger,
  now = new Date(),
): Promise<{ published: number; failed: number }> => {
  const events = medicalBriefingEvents(result, now);
  const settled = await Promise.allSettled(
    events.map((event) => repository.save(event)),
  );
  settled.forEach((outcome, index) => {
    if (outcome.status === 'rejected') {
      logger?.error(
        { briefingEventId: events[index]?.id, err: outcome.reason },
        'Medical briefing event publication failed',
      );
    }
  });
  return {
    published: settled.filter(({ status }) => status === 'fulfilled').length,
    failed: settled.filter(({ status }) => status === 'rejected').length,
  };
};
