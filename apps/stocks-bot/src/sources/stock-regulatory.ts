import { createHash } from 'node:crypto';
import { parseDate, type Source, type WatchItem } from '@watcher/core';
import { z } from 'zod';

export type StockRegulatoryConfig = {
  symbol: string;
  companyName?: string | null;
  maxItems?: number;
};

const clinicalResponseSchema = z.object({
  studies: z.array(
    z.object({
      protocolSection: z.object({
        identificationModule: z.object({
          nctId: z.string().min(1),
          briefTitle: z.string().min(1),
          organization: z
            .object({ fullName: z.string().optional() })
            .optional(),
        }),
        descriptionModule: z
          .object({ briefSummary: z.string().optional() })
          .optional(),
        statusModule: z
          .object({
            overallStatus: z.string().optional(),
            startDateStruct: z
              .object({ date: z.string().optional() })
              .optional(),
            completionDateStruct: z
              .object({ date: z.string().optional() })
              .optional(),
            studyFirstPostDateStruct: z
              .object({ date: z.string().optional() })
              .optional(),
            lastUpdatePostDateStruct: z
              .object({ date: z.string().optional() })
              .optional(),
          })
          .optional(),
        sponsorCollaboratorsModule: z
          .object({
            leadSponsor: z.object({ name: z.string().optional() }).optional(),
            collaborators: z
              .array(z.object({ name: z.string().optional() }))
              .optional(),
          })
          .optional(),
      }),
    }),
  ),
});

const fdaResponseSchema = z.object({
  results: z.array(
    z.object({
      application_number: z.string().min(1),
      sponsor_name: z.string().optional(),
      products: z
        .array(
          z.object({
            brand_name: z.string().optional(),
            active_ingredients: z
              .array(z.object({ name: z.string().optional() }))
              .optional(),
          }),
        )
        .optional(),
      submissions: z
        .array(
          z.object({
            submission_type: z.string().optional(),
            submission_number: z.string().optional(),
            submission_status: z.string().optional(),
            submission_status_date: z.string().optional(),
            review_priority: z.string().optional(),
          }),
        )
        .optional(),
    }),
  ),
});

const requestJson = async (
  fetcher: typeof fetch,
  url: URL,
  schema: typeof clinicalResponseSchema | typeof fdaResponseSchema,
  signal?: AbortSignal,
): Promise<unknown> => {
  const response = await fetcher(url, {
    headers: { accept: 'application/json' },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
  });
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`HTTP ${response.status} from ${url.hostname}`);
  return schema.parse(await response.json());
};

const queryFor = (config: StockRegulatoryConfig): string =>
  config.companyName?.trim() || config.symbol.trim().toUpperCase();

export class StockClinicalTrialsSource implements Source<StockRegulatoryConfig> {
  public readonly id = 'CLINICAL_TRIALS';
  public readonly capabilities = {
    sourceName: 'ClinicalTrials.gov company trials',
    sourceType: 'REGULATORY' as const,
    minimumIntervalMs: 60 * 60_000,
    preferredIntervalMs: 24 * 60 * 60_000,
    maximumIntervalMs: 7 * 24 * 60 * 60_000,
    supportsStreaming: false,
    costPerRequestUsd: 0,
    rateLimitPerMinute: null,
    priority: 95,
  };
  public constructor(private readonly fetcher: typeof fetch = fetch) {}

  public async fetch(
    config: StockRegulatoryConfig,
    signal?: AbortSignal,
  ): Promise<WatchItem[]> {
    const symbol = config.symbol.trim().toUpperCase();
    const query = queryFor(config).replaceAll('"', '');
    const url = new URL('https://clinicaltrials.gov/api/v2/studies');
    url.search = new URLSearchParams({
      'query.term': `AREA[LeadSponsorName]"${query}" OR AREA[CollaboratorName]"${query}"`,
      pageSize: String(Math.max(1, Math.min(config.maxItems ?? 10, 20))),
      format: 'json',
    }).toString();
    const payload = await requestJson(
      this.fetcher,
      url,
      clinicalResponseSchema,
      signal,
    );
    if (!payload) return [];
    return (payload as z.infer<typeof clinicalResponseSchema>).studies.map(
      (study) => {
        const section = study.protocolSection;
        const id = section.identificationModule.nctId;
        const updated = section.statusModule?.lastUpdatePostDateStruct?.date;
        const firstPosted =
          section.statusModule?.studyFirstPostDateStruct?.date;
        const publishedAt = parseDate(updated ?? firstPosted);
        const externalId = `${id}:${updated ?? firstPosted ?? 'unknown'}`;
        const sponsor =
          section.sponsorCollaboratorsModule?.leadSponsor?.name ??
          section.identificationModule.organization?.fullName;
        return {
          id: `${this.id}:${externalId}`,
          source: this.id,
          externalId,
          title: section.identificationModule.briefTitle,
          url: `https://clinicaltrials.gov/study/${id}`,
          ...(publishedAt ? { publishedAt, eventAt: publishedAt } : {}),
          content: `${section.descriptionModule?.briefSummary ?? 'No brief summary.'}\nStatus: ${section.statusModule?.overallStatus ?? 'not reported'}\nLead sponsor: ${sponsor ?? 'not reported'}`,
          sourceType: 'REGULATORY' as const,
          primarySource: true,
          category: 'CLINICAL_TRIAL',
          normalizedFacts: {
            nctId: id,
            status: section.statusModule?.overallStatus,
            sponsor,
            startDate: section.statusModule?.startDateStruct?.date,
            completionDate: section.statusModule?.completionDateStruct?.date,
            lastUpdateDate: updated,
          },
          entities: [symbol, ...(sponsor ? [sponsor] : [])],
          reliability: 0.95,
          metadata: { symbol, query, provider: 'ClinicalTrials.gov' },
        };
      },
    );
  }
}

export class StockFdaSource implements Source<StockRegulatoryConfig> {
  public readonly id = 'FDA';
  public readonly capabilities = {
    sourceName: 'openFDA Drugs@FDA',
    sourceType: 'REGULATORY' as const,
    minimumIntervalMs: 60 * 60_000,
    preferredIntervalMs: 24 * 60 * 60_000,
    maximumIntervalMs: 7 * 24 * 60 * 60_000,
    supportsStreaming: false,
    costPerRequestUsd: 0,
    rateLimitPerMinute: 40,
    priority: 95,
  };
  public constructor(private readonly fetcher: typeof fetch = fetch) {}

  public async fetch(
    config: StockRegulatoryConfig,
    signal?: AbortSignal,
  ): Promise<WatchItem[]> {
    const symbol = config.symbol.trim().toUpperCase();
    const query = queryFor(config).replaceAll('"', '');
    const url = new URL('https://api.fda.gov/drug/drugsfda.json');
    url.search = new URLSearchParams({
      search: `sponsor_name:"${query}"`,
      limit: String(Math.max(1, Math.min(config.maxItems ?? 10, 20))),
    }).toString();
    const payload = await requestJson(
      this.fetcher,
      url,
      fdaResponseSchema,
      signal,
    );
    if (!payload) return [];
    return (payload as z.infer<typeof fdaResponseSchema>).results
      .flatMap((application) => {
        const products = application.products ?? [];
        const productNames = products
          .map(({ brand_name }) => brand_name)
          .filter((name): name is string => Boolean(name));
        return (application.submissions ?? []).flatMap((submission) => {
          if (!submission.submission_status_date) return [];
          const publishedAt = parseDate(submission.submission_status_date);
          if (!publishedAt) return [];
          const status = submission.submission_status ?? 'not reported';
          const submissionId = `${submission.submission_type ?? ''}${submission.submission_number ?? ''}`;
          const externalId = createHash('sha256')
            .update(
              `${application.application_number}:${submissionId}:${submission.submission_status_date}:${status}`,
            )
            .digest('hex');
          return [
            {
              id: `${this.id}:${externalId}`,
              source: this.id,
              externalId,
              title: `${symbol} FDA submission ${application.application_number} ${status}`,
              url: `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${encodeURIComponent(application.application_number.replace(/\D/g, ''))}`,
              publishedAt,
              eventAt: publishedAt,
              content: `Application: ${application.application_number}. Submission: ${submissionId || 'not reported'}. Status: ${status}. Review priority: ${submission.review_priority ?? 'not reported'}. Products: ${productNames.join(', ') || 'not reported'}. Sponsor: ${application.sponsor_name ?? query}.`,
              sourceType: 'REGULATORY' as const,
              primarySource: true,
              category: 'FDA_DECISION',
              normalizedFacts: {
                applicationNumber: application.application_number,
                submissionType: submission.submission_type,
                submissionNumber: submission.submission_number,
                submissionStatus: status,
                submissionStatusDate: submission.submission_status_date,
                reviewPriority: submission.review_priority,
                products: productNames,
                sponsor: application.sponsor_name,
              },
              entities: [
                symbol,
                ...(application.sponsor_name ? [application.sponsor_name] : []),
                ...productNames,
              ],
              reliability: 0.95,
              metadata: { symbol, query, provider: 'openFDA' },
            },
          ];
        });
      })
      .sort(
        (left, right) =>
          (right.publishedAt?.getTime() ?? 0) -
          (left.publishedAt?.getTime() ?? 0),
      )
      .slice(0, Math.max(1, Math.min(config.maxItems ?? 10, 20)));
  }
}
