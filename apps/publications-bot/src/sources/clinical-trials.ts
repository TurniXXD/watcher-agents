import type { Source, WatchItem } from '@watcher/core';
import { z } from 'zod';
import { fetchJson } from './utils/http.js';

const responseSchema = z.object({
  studies: z.array(
    z.object({
      protocolSection: z.object({
        identificationModule: z.object({
          nctId: z.string(),
          briefTitle: z.string(),
        }),
        descriptionModule: z.object({ briefSummary: z.string() }),
        statusModule: z
          .object({ overallStatus: z.string().optional() })
          .optional(),
      }),
    }),
  ),
});

export class ClinicalTrialsSource implements Source<{
  query: string;
  maxItems?: number;
}> {
  public readonly id = 'CLINICAL_TRIALS';
  public readonly capabilities = {
    sourceName: 'ClinicalTrials.gov',
    sourceType: 'REGULATORY' as const,
    minimumIntervalMs: 60_000,
    preferredIntervalMs: 6 * 60 * 60_000,
    maximumIntervalMs: 24 * 60 * 60_000,
    supportsStreaming: false,
    costPerRequestUsd: 0,
    rateLimitPerMinute: null,
    priority: 90,
  };
  public constructor(private readonly fetcher: typeof fetch = fetch) {}

  public async fetch(
    config: { query: string; maxItems?: number },
    signal?: AbortSignal,
  ): Promise<WatchItem[]> {
    const params = new URLSearchParams({
      'query.term': config.query,
      pageSize: String(Math.min(config.maxItems ?? 10, 20)),
      format: 'json',
    });
    const payload = responseSchema.parse(
      await fetchJson(
        this.fetcher,
        `https://clinicaltrials.gov/api/v2/studies?${params}`,
        signal,
      ),
    );
    return payload.studies.flatMap((study) => {
      const { identificationModule, descriptionModule, statusModule } =
        study.protocolSection;
      const nctId = identificationModule.nctId;
      const title = identificationModule.briefTitle;
      const summary = descriptionModule.briefSummary;
      return [
        {
          id: `CLINICAL_TRIALS:${nctId}`,
          source: this.id,
          externalId: nctId,
          title,
          url: `https://clinicaltrials.gov/study/${nctId}`,
          content: summary,
          sourceType: 'REGULATORY',
          primarySource: true,
          category: 'CLINICAL_TRIAL',
          normalizedFacts: { nctId, status: statusModule?.overallStatus },
          entities: [],
          reliability: 0.95,
          metadata: {
            query: config.query,
            overallStatus: statusModule?.overallStatus,
          },
        },
      ];
    });
  }
}
