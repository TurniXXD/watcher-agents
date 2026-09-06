import {
  briefingEventSchema,
  type BriefingEventRepository,
  type PipelineResult,
} from '@watcher/core';
import { describe, expect, it, vi } from 'vitest';
import {
  medicalBriefingEvents,
  publishMedicalBriefingEvents,
} from '../briefing-publisher.js';

const analyzedPublication = (
  importance: number,
  source = 'CLINICAL_TRIALS',
): PipelineResult['analyses'][number] => ({
  item: {
    id: `${source}:NCT1`,
    source,
    externalId: 'NCT1',
    title: 'Phase III study update',
    url: 'https://clinicaltrials.gov/study/NCT1',
    publishedAt: new Date('2026-09-05T06:00:00.000Z'),
    content: 'A completed Phase III study reported its primary outcome.',
    entities: ['melanoma'],
    metadata: { target: 'personalized melanoma vaccine' },
  },
  outcome: {
    status: 'SUCCESS',
    result: {
      title: 'Phase III melanoma vaccine results',
      summary: 'The study reported a clinically relevant primary outcome.',
      importance,
      relevance: 9,
      keyFindings: ['Primary outcome reported'],
      methods: ['Randomized trial'],
      limitations: ['Full paper pending'],
      whyInteresting: 'It may affect clinical development.',
      confidence: 0.75,
    },
  },
});

const result = (): PipelineResult => ({
  fetchedCount: 2,
  newItemCount: 2,
  analyzedCount: 2,
  failedAnalysisCount: 0,
  sourceFailures: [],
  analyses: [analyzedPublication(9), analyzedPublication(4, 'PUBMED')],
});

describe('medical briefing publisher', () => {
  it('publishes relevant research and suppresses low-importance items', () => {
    const events = medicalBriefingEvents(
      result(),
      new Date('2026-09-05T07:00:00.000Z'),
    );

    expect(events).toHaveLength(1);
    expect(briefingEventSchema.parse(events[0])).toMatchObject({
      id: 'medical:CLINICAL_TRIALS:NCT1',
      watcherBot: 'medical',
      category: 'MEDICAL_TRIAL',
      importance: 90,
      relevance: 90,
      actionable: false,
      confidence: 'MEDIUM',
    });
  });

  it('isolates publication failures', async () => {
    const repository: BriefingEventRepository = {
      save: vi.fn(async () => Promise.reject(new Error('unavailable'))),
      list: vi.fn(async () => []),
    };

    await expect(
      publishMedicalBriefingEvents(repository, result()),
    ).resolves.toEqual({ published: 0, failed: 1 });
  });
});
