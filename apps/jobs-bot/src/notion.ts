import { createHash } from 'node:crypto';
import type { JobStore } from '@watcher/database';
import {
  normalizedJobSchema,
  type JobEvaluationResult,
  type NormalizedJob,
} from '@watcher/jobs';
import type { NotionClient } from '@watcher/notion';

export type JobNotionRecord = {
  jobId: string;
  job: NormalizedJob;
  evaluation: Pick<
    JobEvaluationResult,
    | 'score'
    | 'eligibility'
    | 'recommendation'
    | 'hardBlockers'
    | 'uncertainties'
  >;
  sourceName: string;
  firstSeenAt: Date;
};

const richText = (value: string): Array<Record<string, unknown>> =>
  value
    .match(/[\s\S]{1,2000}/gu)
    ?.slice(0, 40)
    .map((content) => ({ type: 'text', text: { content } })) ?? [];

const multiSelectName = (value: string): string =>
  value.replaceAll(',', ' ').trim().slice(0, 100);

const pageProperties = (input: JobNotionRecord): Record<string, unknown> => ({
  'Role title': { title: richText(input.job.title) },
  Company: { rich_text: richText(input.job.company) },
  Eligibility: { select: { name: input.evaluation.eligibility } },
  Recommendation: { select: { name: input.evaluation.recommendation } },
  Score: { number: input.evaluation.score },
  Location: { rich_text: richText(input.job.location ?? '') },
  'Work Mode': { select: { name: input.job.workMode } },
  Technologies: {
    multi_select: [
      ...new Set(
        input.job.technologyStack.map(multiSelectName).filter(Boolean),
      ),
    ].map((name) => ({ name })),
  },
  'Hard Blockers': {
    rich_text: richText(input.evaluation.hardBlockers.join('\n')),
  },
  Uncertainties: {
    rich_text: richText(input.evaluation.uncertainties.join('\n')),
  },
  Source: { rich_text: richText(input.sourceName) },
  'Source URL': { url: input.job.originalUrl },
  'Apply URL': { url: input.job.canonicalApplicationUrl ?? null },
  Published: {
    date: input.job.publishedAt
      ? { start: input.job.publishedAt.toISOString() }
      : null,
  },
  'First Seen': { date: { start: input.firstSeenAt.toISOString() } },
  'Watcher Job ID': { rich_text: richText(input.jobId) },
  Description: { rich_text: richText(input.job.description) },
});

const propertiesHash = (properties: Record<string, unknown>): string =>
  createHash('sha256').update(JSON.stringify(properties)).digest('hex');

export class JobsNotionSync {
  public constructor(
    private readonly store: JobStore,
    private readonly client: NotionClient,
    private readonly dataSourceId: string,
  ) {}

  public async synchronizeStored(batchSize = 100): Promise<{
    scanned: number;
    synced: number;
    failed: number;
  }> {
    let scanned = 0;
    let synced = 0;
    let failed = 0;
    while (true) {
      const rows = await this.store.listJobs({
        take: batchSize,
        skip: scanned,
      });
      for (const row of rows) {
        const evaluation = row.evaluations[0];
        const reference = row.sourceReferences[0];
        if (!evaluation || !reference) continue;
        const job = normalizedJobSchema.parse({
          sourceId: reference.sourceId,
          externalId: reference.externalId,
          title: row.title,
          company: row.company,
          description: row.description,
          ...(row.shortDescription
            ? { shortDescription: row.shortDescription }
            : {}),
          ...(row.location ? { location: row.location } : {}),
          ...(row.country ? { country: row.country } : {}),
          ...(row.city ? { city: row.city } : {}),
          workMode: row.workMode,
          remoteRegions: row.remoteRegions,
          ...(row.salaryMin === null ? {} : { salaryMin: row.salaryMin }),
          ...(row.salaryMax === null ? {} : { salaryMax: row.salaryMax }),
          ...(row.salaryCurrency ? { salaryCurrency: row.salaryCurrency } : {}),
          ...(row.salaryPeriod ? { salaryPeriod: row.salaryPeriod } : {}),
          ...(row.contractType ? { contractType: row.contractType } : {}),
          ...(row.seniority ? { seniority: row.seniority } : {}),
          technologyStack: row.technologyStack,
          originalUrl: row.originalUrl,
          ...(row.canonicalApplicationUrl
            ? { canonicalApplicationUrl: row.canonicalApplicationUrl }
            : {}),
          ...(row.publishedAt ? { publishedAt: row.publishedAt } : {}),
          raw: { persistedJobId: row.id },
        });
        try {
          if (
            await this.synchronize({
              jobId: row.id,
              job,
              evaluation,
              sourceName: reference.source.name,
              firstSeenAt: row.firstSeenAt,
            })
          )
            synced += 1;
        } catch {
          failed += 1;
        }
      }
      scanned += rows.length;
      if (rows.length < batchSize) break;
    }
    return { scanned, synced, failed };
  }

  public async synchronize(input: JobNotionRecord): Promise<boolean> {
    const properties = pageProperties(input);
    const contentHash = propertiesHash(properties);
    const claim = await this.store.claimNotionSync({
      jobId: input.jobId,
      contentHash,
    });
    if (!claim.claimed) return false;

    try {
      let pageId = claim.row.pageId;
      if (!pageId) {
        const existing = await this.client.queryDataSource(
          this.dataSourceId,
          {
            filter: {
              property: 'Watcher Job ID',
              rich_text: { equals: input.jobId },
            },
            page_size: 2,
          },
          AbortSignal.timeout(30_000),
        );
        const candidate = existing.results[0];
        pageId =
          candidate && typeof candidate.id === 'string' ? candidate.id : null;
      }

      if (pageId) {
        await this.client.updatePage(
          pageId,
          { properties },
          AbortSignal.timeout(30_000),
        );
      } else {
        const page = await this.client.createPage(
          {
            parent: {
              type: 'data_source_id',
              data_source_id: this.dataSourceId,
            },
            properties,
          },
          AbortSignal.timeout(30_000),
        );
        if (typeof page.id !== 'string')
          throw new Error('Notion did not return a page ID');
        pageId = page.id;
      }

      await this.store.completeNotionSync({
        jobId: input.jobId,
        pageId,
        contentHash,
      });
      return true;
    } catch (error) {
      await this.store.failNotionSync(input.jobId, error);
      throw error;
    }
  }
}
