import type { JobStore } from '@watcher/database';
import {
  JobSourceHttpError,
  createJobSourceDefinitions,
  evaluateJob,
  jobContentHash,
  normalizedJobSchema,
  verifyJobAvailability,
  type CandidateProfile,
  type JobAiEvaluator,
  type JobAiMetadata,
  type JobAvailability,
  type JobEvaluationResult,
  type JobSourceDefinition,
  type NormalizedJob,
} from '@watcher/jobs';
import type { JobNotionRecord, JobsNotionSync } from './notion.js';

type Logger = {
  info: (object: object, message: string) => void;
  warn: (object: object, message: string) => void;
  error: (object: object, message: string) => void;
};

export type AlertJob = {
  notificationId: string;
  jobId: string;
  title: string;
  company: string;
  location?: string;
  salary?: string;
  score: number;
  eligibility: string;
  reasoning: string;
  hardBlockers?: string[];
  uncertainties?: string[];
  url: string;
  source: string;
  publishedAt?: Date;
};

export type JobRunResult = {
  runId: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'SKIPPED';
  baseline: boolean;
  discovered: number;
  created: number;
  evaluated: number;
  sourceFailures: number;
  alerts: AlertJob[];
};

const listingHash = (job: NormalizedJob): string =>
  jobContentHash({
    title: job.title,
    company: job.company,
    description: job.shortDescription ?? job.description,
    ...(job.location ? { location: job.location } : {}),
  });

export class JobDiscoveryRunner {
  private running = false;

  public constructor(
    private readonly store: JobStore,
    private readonly profile: CandidateProfile,
    private readonly detailRefreshHours: number,
    private readonly logger: Logger,
    private readonly definitions: JobSourceDefinition[] = createJobSourceDefinitions(),
    private readonly aiEvaluator?: JobAiEvaluator,
    private readonly notionSync?: JobsNotionSync,
    private readonly availabilityVerifier: typeof verifyJobAvailability = verifyJobAvailability,
  ) {}

  private async checkApplicationUrl(
    jobId: string,
    url: string,
  ): Promise<JobAvailability> {
    const availability = await this.availabilityVerifier(url);
    await this.store.updateAvailability(jobId, availability);
    return availability;
  }

  private async refreshStoredApplicationLinks(limit = 25): Promise<void> {
    const cutoff = new Date(Date.now() - 24 * 3_600_000);
    const jobs = await this.store.listJobs({
      minimumScore: this.profile.thresholds.possible,
      take: 200,
    });
    const candidates = jobs
      .filter(
        (job) =>
          job.evaluations[0]?.eligibility !== 'INELIGIBLE' &&
          job.availabilityStatus !== 'CLOSED_CONFIRMED' &&
          (!job.lastAvailabilityCheckAt ||
            job.lastAvailabilityCheckAt < cutoff) &&
          Boolean(job.canonicalApplicationUrl ?? job.originalUrl),
      )
      .slice(0, limit);
    for (let offset = 0; offset < candidates.length; offset += 5) {
      const batch = candidates.slice(offset, offset + 5);
      const results = await Promise.allSettled(
        batch.map((job) =>
          this.checkApplicationUrl(
            job.id,
            job.canonicalApplicationUrl ?? job.originalUrl,
          ),
        ),
      );
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const refreshError: unknown = result.reason;
          this.logger.warn(
            { err: refreshError, jobId: batch[index]?.id },
            'Stored job application-link check failed',
          );
        }
      });
    }
  }

  private async synchronizeNotion(input: JobNotionRecord): Promise<void> {
    if (!this.notionSync) return;
    try {
      await this.notionSync.synchronize(input);
    } catch (error) {
      this.logger.warn(
        { err: error, jobId: input.jobId },
        'Notion job synchronization failed; PostgreSQL remains authoritative',
      );
    }
  }

  private async evaluate(
    job: NormalizedJob,
    profile: CandidateProfile,
  ): Promise<{ result: JobEvaluationResult; ai?: JobAiMetadata }> {
    const deterministic = evaluateJob(job, profile);
    if (!this.aiEvaluator) return { result: deterministic };
    try {
      const evaluated = await this.aiEvaluator.evaluate(
        job,
        profile,
        deterministic,
      );
      return { result: evaluated.result, ai: evaluated.metadata };
    } catch (error) {
      this.logger.warn(
        { err: error, source: job.sourceId, externalId: job.externalId },
        'AI evaluation failed; using deterministic evaluation',
      );
      return { result: deterministic };
    }
  }

  public async initialize(): Promise<void> {
    await this.store.syncSources(this.definitions);
    await this.store.ensureProfile(this.profile);
    if (this.notionSync) {
      const synchronized = await this.notionSync.synchronizeStored();
      this.logger.info(
        synchronized,
        'Existing jobs Notion synchronization completed',
      );
    }
  }

  public async reevaluateExisting(limit = 1_000): Promise<{
    scanned: number;
    evaluated: number;
  }> {
    if (this.running) throw new Error('A job discovery run is already active');
    this.running = true;
    try {
      const activeProfile = await this.store.getActiveProfile();
      if (!activeProfile)
        throw new Error('Candidate profile is not initialized');
      const jobs = await this.store.listJobs({ take: limit });
      let evaluated = 0;
      for (const row of jobs) {
        const previous = row.evaluations[0];
        if (
          previous?.profileVersion === activeProfile.row.version &&
          previous.jobContentHash === row.contentHash
        ) {
          continue;
        }
        const source = row.sourceReferences[0];
        const job = normalizedJobSchema.parse({
          sourceId: source?.sourceId ?? 'persisted',
          externalId: source?.externalId ?? row.id,
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
        const evaluatedJob = await this.evaluate(job, activeProfile.profile);
        const result = evaluatedJob.result;
        await this.store.saveEvaluation({
          jobId: row.id,
          profileId: activeProfile.row.id,
          profileVersion: activeProfile.row.version,
          jobContentHash: row.contentHash,
          result,
          ...(evaluatedJob.ai ? { ai: evaluatedJob.ai } : {}),
        });
        await this.synchronizeNotion({
          jobId: row.id,
          job,
          evaluation: result,
          sourceName: source?.source.name ?? source?.sourceId ?? 'Persisted',
          firstSeenAt: row.firstSeenAt,
        });
        evaluated += 1;
      }
      return { scanned: jobs.length, evaluated };
    } finally {
      this.running = false;
    }
  }

  public async run(input: {
    trigger: 'MANUAL' | 'SCHEDULED';
    sourceId?: string;
    dryRun?: boolean;
  }): Promise<JobRunResult> {
    if (this.running)
      return {
        runId: 'overlap-prevented',
        status: 'SKIPPED',
        baseline: false,
        discovered: 0,
        created: 0,
        evaluated: 0,
        sourceFailures: 0,
        alerts: [],
      };
    this.running = true;
    const dryRun = input.dryRun ?? false;
    let run: { id: string; baseline: boolean } | undefined;
    let discovered = 0;
    let created = 0;
    let evaluated = 0;
    const alerts: AlertJob[] = [];
    try {
      run = dryRun
        ? { id: 'dry-run', baseline: false }
        : await this.store.startRun({ trigger: input.trigger, dryRun: false });
      if ('claimed' in run && run.claimed === false) {
        return {
          runId: run.id,
          status: 'SKIPPED',
          baseline: run.baseline,
          discovered: 0,
          created: 0,
          evaluated: 0,
          sourceFailures: 0,
          alerts: [],
        };
      }
      const currentRun = run;
      const storedSources = await this.store.listSources();
      const enabledIds = new Set(
        storedSources
          .filter((source) => source.enabled)
          .map((source) => source.id),
      );
      const selected = this.definitions.filter(
        (definition) =>
          definition.adapter &&
          enabledIds.has(definition.id) &&
          (!input.sourceId || input.sourceId === definition.id),
      );
      if (input.sourceId && selected.length === 0) {
        throw new Error(
          `Source is not enabled or implemented: ${input.sourceId}`,
        );
      }
      const settled = await Promise.allSettled(
        selected.map(async (definition) => {
          const adapter = definition.adapter!;
          const storedCheckpoint = await this.store.getCheckpoint(adapter.id);
          const checkpoint = storedCheckpoint
            ? {
                ...(storedCheckpoint.etag
                  ? { etag: storedCheckpoint.etag }
                  : {}),
                ...(storedCheckpoint.lastModified
                  ? { lastModified: storedCheckpoint.lastModified }
                  : {}),
                value: storedCheckpoint.value,
              }
            : undefined;
          const sourceResult = await adapter.discover({
            ...(checkpoint ? { checkpoint } : {}),
          });
          if (sourceResult.checkpoint && !dryRun)
            await this.store.saveCheckpoint(
              adapter.id,
              sourceResult.checkpoint,
            );

          const sourceAlerts: AlertJob[] = [];
          let sourceCreated = 0;
          let sourceEvaluated = 0;
          const activeProfile = dryRun
            ? undefined
            : await this.store.getActiveProfile();
          if (!dryRun && !activeProfile)
            throw new Error('Candidate profile is not initialized');
          for (const discoveredJob of sourceResult.jobs) {
            const previous = await this.store.findRawJob(
              discoveredJob.sourceId,
              discoveredJob.externalId,
            );
            const stale =
              !previous?.lastDetailFetchedAt ||
              previous.lastDetailFetchedAt.getTime() <
                Date.now() - this.detailRefreshHours * 3_600_000;
            const changed =
              previous?.listingHash !== listingHash(discoveredJob);
            let job = discoveredJob;
            let detailFetched = !adapter.fetchDetail;
            if (adapter.fetchDetail && (!previous || changed || stale)) {
              try {
                job = await adapter.fetchDetail(discoveredJob, {});
                detailFetched = true;
              } catch (error) {
                this.logger.warn(
                  {
                    err: error,
                    source: adapter.id,
                    externalId: job.externalId,
                  },
                  'Job detail enrichment failed; using listing data',
                );
              }
            }
            if (dryRun) continue;
            if (!activeProfile)
              throw new Error('Candidate profile is not initialized');
            const stored = await this.store.upsertJob(job, new Date(), {
              listing: discoveredJob,
              detailFetched,
            });
            const applicationUrl =
              job.canonicalApplicationUrl ?? job.originalUrl;
            let availability = stored.job.availabilityStatus;
            if (stored.isNew) sourceCreated += 1;
            const previousEvaluation = await this.store.findEvaluation(
              stored.job.id,
              activeProfile.row.id,
            );
            const requiresEvaluation =
              !previousEvaluation ||
              previousEvaluation.jobContentHash !== stored.contentHash ||
              previousEvaluation.profileVersion !== activeProfile.row.version;
            if (!requiresEvaluation) continue;
            const evaluatedJob = await this.evaluate(
              job,
              activeProfile.profile,
            );
            const result = evaluatedJob.result;
            const evaluation = await this.store.saveEvaluation({
              jobId: stored.job.id,
              profileId: activeProfile.row.id,
              profileVersion: activeProfile.row.version,
              jobContentHash: stored.contentHash,
              result,
              ...(evaluatedJob.ai ? { ai: evaluatedJob.ai } : {}),
            });
            await this.synchronizeNotion({
              jobId: stored.job.id,
              job,
              evaluation: result,
              sourceName: definition.name,
              firstSeenAt: stored.job.firstSeenAt,
            });
            sourceEvaluated += 1;
            if (
              stored.isNew &&
              result.eligibility !== 'INELIGIBLE' &&
              result.score >= activeProfile.profile.thresholds.notify
            ) {
              if (!currentRun.baseline)
                availability = await this.checkApplicationUrl(
                  stored.job.id,
                  applicationUrl,
                );
              if (!currentRun.baseline && availability === 'CLOSED_CONFIRMED')
                continue;
              const notification = await this.store.reserveNotification({
                jobId: stored.job.id,
                evaluationId: evaluation.id,
                key: `${stored.job.id}:initial-digest`,
                baseline: currentRun.baseline,
              });
              if (
                notification.reserved &&
                notification.row.status === 'PENDING'
              ) {
                sourceAlerts.push({
                  notificationId: notification.row.id,
                  jobId: stored.job.id,
                  title: job.title,
                  company: job.company,
                  ...(job.location ? { location: job.location } : {}),
                  ...(job.salaryMin || job.salaryMax
                    ? {
                        salary:
                          `${job.salaryMin ?? '?'}–${job.salaryMax ?? '?'} ${job.salaryCurrency ?? ''}`.trim(),
                      }
                    : {}),
                  score: result.score,
                  eligibility: result.eligibility,
                  reasoning: result.reasoning,
                  hardBlockers: result.hardBlockers,
                  uncertainties: result.uncertainties,
                  url: job.canonicalApplicationUrl ?? job.originalUrl,
                  source: definition.name,
                  ...(job.publishedAt ? { publishedAt: job.publishedAt } : {}),
                });
              }
            }
          }
          if (!dryRun)
            await this.store.recordSourceSuccess(
              adapter.id,
              sourceResult.jobs.length,
            );
          return {
            discovered: sourceResult.jobs.length,
            created: sourceCreated,
            evaluated: sourceEvaluated,
            alerts: sourceAlerts,
          };
        }),
      );
      let sourceFailures = 0;
      for (let index = 0; index < settled.length; index += 1) {
        const result = settled[index];
        const definition = selected[index];
        if (!result || !definition) continue;
        if (result.status === 'fulfilled') {
          discovered += result.value.discovered;
          created += result.value.created;
          evaluated += result.value.evaluated;
          alerts.push(...result.value.alerts);
        } else {
          sourceFailures += 1;
          const sourceError: unknown = result.reason;
          const retryable =
            sourceError instanceof JobSourceHttpError
              ? sourceError.retryable
              : true;
          if (!dryRun)
            await this.store.recordSourceFailure(
              definition.id,
              currentRun.id,
              sourceError,
              retryable,
            );
          this.logger.error(
            { err: sourceError, source: definition.id },
            'Job source failed',
          );
        }
      }
      const status =
        sourceFailures === 0
          ? 'SUCCESS'
          : sourceFailures === selected.length
            ? 'FAILED'
            : 'PARTIAL';
      if (!dryRun) await this.refreshStoredApplicationLinks();
      if (!dryRun)
        await this.store.finishRun(currentRun.id, {
          status,
          discoveredCount: discovered,
          newCount: created,
          evaluatedCount: evaluated,
          notifiedCount: 0,
          sourceFailures,
        });
      return {
        runId: currentRun.id,
        status,
        baseline: currentRun.baseline,
        discovered,
        created,
        evaluated,
        sourceFailures,
        alerts: currentRun.baseline ? [] : alerts,
      };
    } catch (error) {
      if (run && !dryRun)
        await this.store.finishRun(run.id, {
          status: 'FAILED',
          discoveredCount: discovered,
          newCount: created,
          evaluatedCount: evaluated,
          notifiedCount: 0,
          sourceFailures: 1,
          error: error instanceof Error ? error.message : String(error),
        });
      throw error;
    } finally {
      this.running = false;
    }
  }
}
