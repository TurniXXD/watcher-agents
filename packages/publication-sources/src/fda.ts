import type { Source, WatchItem } from '@watcher/core';
import { z } from 'zod';
import { fetchJson } from './http.js';

const responseSchema = z.object({
  results: z.array(
    z.object({
      safetyreportid: z.union([z.string(), z.number()]).transform(String),
      receiptdate: z
        .union([z.string(), z.number()])
        .transform(String)
        .optional(),
      patient: z.unknown().optional(),
      serious: z.unknown().optional(),
    }),
  ),
});

export class FdaSource implements Source<{ query: string; maxItems?: number }> {
  public readonly id = 'FDA';
  public constructor(private readonly fetcher: typeof fetch = fetch) {}

  public async fetch(
    config: { query: string; maxItems?: number },
    signal?: AbortSignal,
  ): Promise<WatchItem[]> {
    const params = new URLSearchParams({
      search: `patient.drug.openfda.generic_name:"${config.query.replaceAll('"', '')}"`,
      limit: String(Math.min(config.maxItems ?? 10, 20)),
    });
    let payload: z.infer<typeof responseSchema>;
    try {
      payload = responseSchema.parse(
        await fetchJson(
          this.fetcher,
          `https://api.fda.gov/drug/event.json?${params}`,
          signal,
        ),
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('HTTP 404'))
        return [];
      throw error;
    }
    return payload.results.flatMap((report) => {
      const id = report.safetyreportid;
      const reactions = JSON.stringify(report.patient ?? {}).slice(0, 12_000);
      const publishedAt = report.receiptdate
        ? new Date(
            `${report.receiptdate.slice(0, 4)}-${report.receiptdate.slice(4, 6)}-${report.receiptdate.slice(6, 8)}T00:00:00Z`,
          )
        : undefined;
      return [
        {
          id: `FDA:${id}`,
          source: this.id,
          externalId: id,
          title: `FDA adverse event report ${id}`,
          url: `https://api.fda.gov/drug/event.json?search=safetyreportid:${id}`,
          ...(publishedAt === undefined ? {} : { publishedAt }),
          content: reactions,
          metadata: { query: config.query, serious: report.serious },
        },
      ];
    });
  }
}
