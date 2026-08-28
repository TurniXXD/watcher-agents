import type { Source, WatchItem } from '@watcher/core';
import { z } from 'zod';
import { fetchJson } from './http.js';

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
          metadata: {
            query: config.query,
            overallStatus: statusModule?.overallStatus,
          },
        },
      ];
    });
  }
}
