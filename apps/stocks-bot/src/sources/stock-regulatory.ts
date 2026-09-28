import { createHash } from 'node:crypto';
import {
  parseDate,
  sourceHttpError,
  type Source,
  type WatchItem,
} from '@watcher/core';
import { z } from 'zod';
import { companyMention } from './company-mention.js';

export type StockRegulatoryConfig = {
  symbol: string;
  companyName?: string | null;
  industry?: string | null;
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

const fdaEnforcementSchema = z.object({
  results: z.array(
    z.object({
      recall_number: z.string().min(1),
      recalling_firm: z.string().min(1),
      product_description: z.string().min(1),
      reason_for_recall: z.string().min(1),
      report_date: z.string().min(1),
      classification: z.string().optional(),
      status: z.string().optional(),
    }),
  ),
});

const requestJson = async (
  fetcher: typeof fetch,
  url: URL,
  schema:
    | typeof clinicalResponseSchema
    | typeof fdaResponseSchema
    | typeof fdaEnforcementSchema,
  signal?: AbortSignal,
): Promise<unknown> => {
  const response = await fetcher(url, {
    headers: { accept: 'application/json' },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw sourceHttpError(response, url);
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
  public constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly onEndpointError?: (
      endpoint: string,
      error: unknown,
    ) => void,
  ) {}

  async #recalls(
    config: StockRegulatoryConfig,
    query: string,
    signal?: AbortSignal,
  ): Promise<WatchItem[]> {
    if (
      !/biotech|pharma|drug|medical|health\s*care|diagnostic/i.test(
        config.industry ?? '',
      )
    ) {
      return [];
    }
    const maxItems = Math.max(1, Math.min(config.maxItems ?? 10, 20));
    const symbol = config.symbol.trim().toUpperCase();
    const endpoints = ['drug', 'device'] as const;
    const outcomes = await Promise.allSettled(
      endpoints.map(async (kind) => {
        const url = new URL(`https://api.fda.gov/${kind}/enforcement.json`);
        url.searchParams.set('search', `recalling_firm:"${query}"`);
        url.searchParams.set('sort', 'report_date:desc');
        url.searchParams.set('limit', String(maxItems));
        const payload = await requestJson(
          this.fetcher,
          url,
          fdaEnforcementSchema,
          signal,
        );
        if (!payload) return [];
        return (
          payload as z.infer<typeof fdaEnforcementSchema>
        ).results.flatMap((recall): WatchItem[] => {
          if (!companyMention(recall.recalling_firm, query)) return [];
          const publishedAt = parseDate(recall.report_date);
          if (!publishedAt) return [];
          const externalId = `${kind}:${recall.recall_number}`;
          const recordUrl = new URL(url);
          recordUrl.searchParams.set(
            'search',
            `recall_number:"${recall.recall_number}"`,
          );
          recordUrl.searchParams.delete('sort');
          recordUrl.searchParams.delete('limit');
          return [
            {
              id: `${this.id}:${externalId}`,
              source: this.id,
              externalId,
              title: `${symbol} FDA ${kind} recall ${recall.recall_number}`,
              url: recordUrl.toString(),
              publishedAt,
              eventAt: publishedAt,
              content: `Product: ${recall.product_description}. Reason: ${recall.reason_for_recall}. Classification: ${recall.classification ?? 'not reported'}. Status: ${recall.status ?? 'not reported'}. Recalling firm: ${recall.recalling_firm}.`,
              sourceType: 'REGULATORY',
              primarySource: true,
              category: 'REGULATORY_ACTION',
              normalizedFacts: {
                recallNumber: recall.recall_number,
                product: recall.product_description,
                reason: recall.reason_for_recall,
                classification: recall.classification,
                status: recall.status,
                recallingFirm: recall.recalling_firm,
                reportDate: recall.report_date,
              },
              entities: [symbol, recall.recalling_firm],
              reliability: 0.95,
              metadata: { symbol, provider: 'openFDA', endpoint: kind },
            },
          ];
        });
      }),
    );
    const items: WatchItem[] = [];
    for (const [index, outcome] of outcomes.entries()) {
      if (outcome.status === 'fulfilled') {
        items.push(...outcome.value);
      } else {
        if (signal?.aborted) throw outcome.reason;
        this.onEndpointError?.(endpoints[index] ?? 'unknown', outcome.reason);
      }
    }
    if (outcomes.every((outcome) => outcome.status === 'rejected')) {
      throw new Error('Both openFDA enforcement endpoints failed');
    }
    return items
      .sort(
        (left, right) =>
          (right.publishedAt?.getTime() ?? 0) -
          (left.publishedAt?.getTime() ?? 0),
      )
      .slice(0, maxItems);
  }

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
    let payload: unknown = null;
    let approvalError: unknown;
    try {
      payload = await requestJson(this.fetcher, url, fdaResponseSchema, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      approvalError = error;
      this.onEndpointError?.('drugsfda', error);
    }
    const decisions = (
      payload ? (payload as z.infer<typeof fdaResponseSchema>).results : []
    )
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
    let recalls: WatchItem[] = [];
    let recallError: unknown;
    try {
      recalls = await this.#recalls(config, query, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      recallError = error;
    }
    if (decisions.length === 0 && recalls.length === 0) {
      if (approvalError)
        throw approvalError instanceof Error
          ? approvalError
          : new Error('Drugs@FDA request failed', { cause: approvalError });
      if (recallError)
        throw recallError instanceof Error
          ? recallError
          : new Error('openFDA recall requests failed', { cause: recallError });
    }
    return [...decisions, ...recalls];
  }
}
