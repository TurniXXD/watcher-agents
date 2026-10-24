import { computeNextRun } from '@watcher/core';
import {
  candidateProfileSchema,
  extractJobRequirements,
  jobContentHash,
  jobFingerprint,
  normalizeText,
  type CandidateProfile,
  type JobAiMetadata,
  type JobEvaluationResult,
  type JobSourceDefinition,
  type NormalizedJob,
} from '@watcher/jobs';
import type { DatabaseClient } from './client.js';
import { Prisma } from './generated/prisma/client.js';
import {
  JobApplicationStatus,
  JobEligibilityState,
  JobNotificationStatus,
  JobRecommendationLevel,
  RunStatus,
  RunTrigger,
  SourceHealthStatus,
} from './generated/prisma/enums.js';

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

const upsertJobSourceReference = async (
  transaction: Prisma.TransactionClient,
  input: {
    jobId: string;
    sourceId: string;
    externalId: string;
    sourceUrl: string;
    canonicalApplicationUrl: string | null;
    lastSeenAt: Date;
  },
) => {
  const existingIdentity = await transaction.jobSourceReference.findUnique({
    where: {
      sourceId_externalId: {
        sourceId: input.sourceId,
        externalId: input.externalId,
      },
    },
  });
  if (existingIdentity) {
    const existingUrl = await transaction.jobSourceReference.findUnique({
      where: {
        jobId_sourceUrl: {
          jobId: input.jobId,
          sourceUrl: input.sourceUrl,
        },
      },
    });
    if (existingUrl && existingUrl.id !== existingIdentity.id) {
      await transaction.jobSourceReference.delete({
        where: { id: existingIdentity.id },
      });
      return transaction.jobSourceReference.update({
        where: { id: existingUrl.id },
        data: {
          canonicalApplicationUrl: input.canonicalApplicationUrl,
          lastSeenAt: input.lastSeenAt,
        },
      });
    }
    return transaction.jobSourceReference.update({
      where: { id: existingIdentity.id },
      data: {
        jobId: input.jobId,
        sourceUrl: input.sourceUrl,
        canonicalApplicationUrl: input.canonicalApplicationUrl,
        lastSeenAt: input.lastSeenAt,
      },
    });
  }
  return transaction.jobSourceReference.upsert({
    where: {
      jobId_sourceUrl: {
        jobId: input.jobId,
        sourceUrl: input.sourceUrl,
      },
    },
    create: {
      jobId: input.jobId,
      sourceId: input.sourceId,
      externalId: input.externalId,
      sourceUrl: input.sourceUrl,
      canonicalApplicationUrl: input.canonicalApplicationUrl,
    },
    update: {
      canonicalApplicationUrl: input.canonicalApplicationUrl,
      lastSeenAt: input.lastSeenAt,
    },
  });
};

const profileFromRow = (profile: {
  name: string;
  professionalTitle: string;
  yearsExperience: number;
  educationLevel: string;
  languages: Prisma.JsonValue;
  preferredRoles: string[];
  avoidedRoles: string[];
  preferredLocations: Prisma.JsonValue;
  profileData: Prisma.JsonValue;
  scoringWeights: Prisma.JsonValue;
  excellentThreshold: number;
  strongThreshold: number;
  possibleThreshold: number;
  notificationThreshold: number;
  skills: Array<{ name: string; proficiency: string; years: number | null }>;
}): CandidateProfile =>
  candidateProfileSchema.parse({
    ...(profile.profileData &&
    typeof profile.profileData === 'object' &&
    !Array.isArray(profile.profileData)
      ? profile.profileData
      : {}),
    name: profile.name,
    professionalTitle: profile.professionalTitle,
    yearsExperience: profile.yearsExperience,
    educationLevel: profile.educationLevel,
    languages: profile.languages,
    preferredRoles: profile.preferredRoles,
    avoidedRoles: profile.avoidedRoles,
    preferredLocations: profile.preferredLocations,
    skills: profile.skills.map((skill) => ({
      name: skill.name,
      proficiency: skill.proficiency,
      ...(skill.years === null ? {} : { years: skill.years }),
    })),
    weights: profile.scoringWeights,
    thresholds: {
      excellent: profile.excellentThreshold,
      strong: profile.strongThreshold,
      possible: profile.possibleThreshold,
      notify: profile.notificationThreshold,
    },
  });

export type StoredJob = Awaited<ReturnType<JobStore['getJob']>>;

export class JobStore {
  public constructor(private readonly db: DatabaseClient) {}

  public async ensureProfile(profileInput: CandidateProfile) {
    const profile = candidateProfileSchema.parse(profileInput);
    const existing = await this.db.jobCandidateProfile.findFirst({
      where: { active: true },
      include: { skills: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (existing) {
      const existingData =
        existing.profileData &&
        typeof existing.profileData === 'object' &&
        !Array.isArray(existing.profileData)
          ? existing.profileData
          : {};
      const needsPreferenceMigration =
        !('requiredTechnologies' in existingData) ||
        !('excludedTechnologies' in existingData) ||
        !('adjacentRoles' in existingData);
      if (!needsPreferenceMigration)
        return { row: existing, profile: profileFromRow(existing) };

      const migrated = profileFromRow(existing);
      const row = await this.updateProfile(existing.id, migrated);
      return { row, profile: profileFromRow(row) };
    }
    const row = await this.db.jobCandidateProfile.create({
      data: {
        name: profile.name,
        professionalTitle: profile.professionalTitle,
        yearsExperience: profile.yearsExperience,
        educationLevel: profile.educationLevel,
        languages: json(profile.languages),
        preferredRoles: profile.preferredRoles,
        avoidedRoles: profile.avoidedRoles,
        preferredLocations: json(profile.preferredLocations),
        profileData: json({
          ...(profile.summary ? { summary: profile.summary } : {}),
          ...(profile.website ? { website: profile.website } : {}),
          ...(profile.github ? { github: profile.github } : {}),
          ...(profile.linkedin ? { linkedin: profile.linkedin } : {}),
          experience: profile.experience,
          requiredTechnologies: profile.requiredTechnologies,
          excludedTechnologies: profile.excludedTechnologies,
          adjacentRoles: profile.adjacentRoles,
        }),
        scoringWeights: json(profile.weights),
        excellentThreshold: profile.thresholds.excellent,
        strongThreshold: profile.thresholds.strong,
        possibleThreshold: profile.thresholds.possible,
        notificationThreshold: profile.thresholds.notify,
        skills: {
          create: profile.skills.map((skill) => ({
            name: skill.name,
            normalized: normalizeText(skill.name),
            proficiency: skill.proficiency,
            ...(skill.years === undefined ? {} : { years: skill.years }),
          })),
        },
      },
      include: { skills: true },
    });
    return { row, profile };
  }

  public async getActiveProfile() {
    const row = await this.db.jobCandidateProfile.findFirst({
      where: { active: true },
      include: { skills: true },
      orderBy: { updatedAt: 'desc' },
    });
    return row ? { row, profile: profileFromRow(row) } : undefined;
  }

  public async updateProfile(id: string, profileInput: CandidateProfile) {
    const profile = candidateProfileSchema.parse(profileInput);
    return this.db.$transaction(async (transaction) => {
      await transaction.jobCandidateSkill.deleteMany({
        where: { profileId: id },
      });
      return transaction.jobCandidateProfile.update({
        where: { id },
        data: {
          name: profile.name,
          professionalTitle: profile.professionalTitle,
          yearsExperience: profile.yearsExperience,
          educationLevel: profile.educationLevel,
          languages: json(profile.languages),
          preferredRoles: profile.preferredRoles,
          avoidedRoles: profile.avoidedRoles,
          preferredLocations: json(profile.preferredLocations),
          profileData: json({
            ...(profile.summary ? { summary: profile.summary } : {}),
            ...(profile.website ? { website: profile.website } : {}),
            ...(profile.github ? { github: profile.github } : {}),
            ...(profile.linkedin ? { linkedin: profile.linkedin } : {}),
            experience: profile.experience,
            requiredTechnologies: profile.requiredTechnologies,
            excludedTechnologies: profile.excludedTechnologies,
            adjacentRoles: profile.adjacentRoles,
          }),
          scoringWeights: json(profile.weights),
          excellentThreshold: profile.thresholds.excellent,
          strongThreshold: profile.thresholds.strong,
          possibleThreshold: profile.thresholds.possible,
          notificationThreshold: profile.thresholds.notify,
          version: { increment: 1 },
          skills: {
            create: profile.skills.map((skill) => ({
              name: skill.name,
              normalized: normalizeText(skill.name),
              proficiency: skill.proficiency,
              ...(skill.years === undefined ? {} : { years: skill.years }),
            })),
          },
        },
        include: { skills: true },
      });
    });
  }

  public async syncSources(definitions: JobSourceDefinition[]) {
    const existingSources = await this.db.jobSource.findMany({
      where: { id: { in: definitions.map((source) => source.id) } },
      select: { id: true, collectionStrategy: true },
    });
    const previouslyUnsupported = new Set(
      existingSources
        .filter((source) => source.collectionStrategy === 'DISABLED')
        .map((source) => source.id),
    );
    await this.db.$transaction(
      definitions.map((source) =>
        this.db.jobSource.upsert({
          where: { id: source.id },
          create: {
            id: source.id,
            name: source.name,
            baseUrl: source.baseUrl,
            collectionStrategy: source.strategy,
            enabled: source.enabledByDefault,
            healthStatus: source.enabledByDefault
              ? SourceHealthStatus.DEGRADED
              : SourceHealthStatus.UNAVAILABLE,
            termsNote: source.attribution ?? null,
            disabledReason: source.disabledReason ?? null,
            fetchIntervalMinutes: source.fetchIntervalMinutes ?? 240,
            rateLimitPerMinute: source.rateLimitPerMinute ?? 30,
          },
          update: {
            name: source.name,
            baseUrl: source.baseUrl,
            collectionStrategy: source.strategy,
            termsNote: source.attribution ?? null,
            disabledReason: source.disabledReason ?? null,
            fetchIntervalMinutes: source.fetchIntervalMinutes ?? 240,
            rateLimitPerMinute: source.rateLimitPerMinute ?? 30,
            ...(source.enabledByDefault && previouslyUnsupported.has(source.id)
              ? {
                  enabled: true,
                  healthStatus: SourceHealthStatus.DEGRADED,
                }
              : {}),
          },
        }),
      ),
    );
  }

  public listSources() {
    return this.db.jobSource.findMany({ orderBy: { name: 'asc' } });
  }

  public async setSourceEnabled(id: string, enabled: boolean) {
    const updated = await this.db.jobSource.updateMany({
      where: {
        id,
        ...(enabled ? { collectionStrategy: { not: 'DISABLED' } } : {}),
      },
      data: { enabled },
    });
    if (updated.count !== 1)
      throw new Error('Unsupported sources cannot be enabled');
    return this.db.jobSource.findUniqueOrThrow({ where: { id } });
  }

  public getCheckpoint(sourceId: string) {
    return this.db.jobSourceCheckpoint.findUnique({
      where: { sourceId_checkpointKey: { sourceId, checkpointKey: 'listing' } },
    });
  }

  public saveCheckpoint(
    sourceId: string,
    input: { value?: unknown; etag?: string; lastModified?: string },
    now = new Date(),
  ) {
    return this.db.jobSourceCheckpoint.upsert({
      where: { sourceId_checkpointKey: { sourceId, checkpointKey: 'listing' } },
      create: {
        sourceId,
        checkpointKey: 'listing',
        value: json(input.value ?? {}),
        etag: input.etag ?? null,
        lastModified: input.lastModified ?? null,
        checkedAt: now,
      },
      update: {
        value: json(input.value ?? {}),
        etag: input.etag ?? null,
        lastModified: input.lastModified ?? null,
        checkedAt: now,
      },
    });
  }

  public async startRun(
    input: {
      trigger: 'MANUAL' | 'SCHEDULED';
      dryRun: boolean;
    },
    now = new Date(),
  ) {
    return this.db.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('jobs-discovery-run'))`;
      const staleBefore = new Date(now.getTime() - 2 * 60 * 60_000);
      const active = await transaction.jobScrapeRun.findFirst({
        where: { status: RunStatus.RUNNING, startedAt: { gte: staleBefore } },
        orderBy: { startedAt: 'desc' },
      });
      if (active) return { ...active, claimed: false as const };
      await transaction.jobScrapeRun.updateMany({
        where: { status: RunStatus.RUNNING, startedAt: { lt: staleBefore } },
        data: {
          status: RunStatus.FAILED,
          completedAt: now,
          error: 'Run lease expired before completion',
        },
      });
      const completed = await transaction.jobScrapeRun.count({
        where: { status: { in: [RunStatus.SUCCESS, RunStatus.PARTIAL] } },
      });
      const row = await transaction.jobScrapeRun.create({
        data: {
          trigger: RunTrigger[input.trigger],
          dryRun: input.dryRun,
          baseline: completed === 0,
          startedAt: now,
        },
      });
      return { ...row, claimed: true as const };
    });
  }

  public finishRun(
    id: string,
    input: {
      status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'SKIPPED';
      discoveredCount: number;
      newCount: number;
      evaluatedCount: number;
      notifiedCount: number;
      sourceFailures: number;
      error?: string;
    },
  ) {
    return this.db.jobScrapeRun.update({
      where: { id },
      data: {
        status: RunStatus[input.status],
        completedAt: new Date(),
        discoveredCount: input.discoveredCount,
        newCount: input.newCount,
        evaluatedCount: input.evaluatedCount,
        notifiedCount: input.notifiedCount,
        sourceFailures: input.sourceFailures,
        error: input.error ?? null,
      },
    });
  }

  public recordRunNotifications(id: string, notifiedCount: number) {
    return this.db.jobScrapeRun.update({
      where: { id },
      data: { notifiedCount },
    });
  }

  public async recordSourceSuccess(
    sourceId: string,
    discovered: number,
    now = new Date(),
  ) {
    await this.db.jobSource.update({
      where: { id: sourceId },
      data: {
        healthStatus: SourceHealthStatus.HEALTHY,
        lastCheckedAt: now,
        lastSuccessfulAt: now,
        lastError: null,
        discoveredCount: { increment: discovered },
      },
    });
  }

  public async recordSourceFailure(
    sourceId: string,
    runId: string,
    error: unknown,
    retryable: boolean,
    now = new Date(),
  ) {
    const message = error instanceof Error ? error.message : String(error);
    await this.db.$transaction([
      this.db.jobSource.update({
        where: { id: sourceId },
        data: {
          healthStatus: retryable
            ? SourceHealthStatus.RATE_LIMITED
            : SourceHealthStatus.DEGRADED,
          lastCheckedAt: now,
          lastError: message.slice(0, 2_000),
        },
      }),
      this.db.jobSourceError.create({
        data: {
          sourceId,
          runId,
          message: message.slice(0, 2_000),
          retryable,
        },
      }),
    ]);
  }

  public findRawJob(sourceId: string, externalId: string) {
    return this.db.jobRawJob.findUnique({
      where: { sourceId_externalId: { sourceId, externalId } },
    });
  }

  public async upsertJob(
    job: NormalizedJob,
    now = new Date(),
    options?: { listing?: NormalizedJob; detailFetched?: boolean },
  ) {
    const listing = options?.listing ?? job;
    const detailFetched = options?.detailFetched ?? true;
    const originalHost = new URL(job.originalUrl).hostname;
    const applicationHost = job.canonicalApplicationUrl
      ? new URL(job.canonicalApplicationUrl).hostname
      : undefined;
    const employerApplicationUrl =
      job.canonicalApplicationUrl && applicationHost !== originalHost
        ? job.canonicalApplicationUrl
        : undefined;
    const fingerprint = jobFingerprint({
      title: job.title,
      company: job.company,
      ...(job.location ? { location: job.location } : {}),
      ...(employerApplicationUrl
        ? { applicationUrl: employerApplicationUrl }
        : {}),
    });
    const contentHash = jobContentHash({
      title: job.title,
      company: job.company,
      description: job.description,
      ...(job.location ? { location: job.location } : {}),
      ...(job.canonicalApplicationUrl
        ? { applicationUrl: job.canonicalApplicationUrl }
        : {}),
    });
    const listingHash = jobContentHash({
      title: listing.title,
      company: listing.company,
      description: listing.shortDescription ?? listing.description,
      ...(listing.location ? { location: listing.location } : {}),
    });
    return this.db.$transaction(async (transaction) => {
      const previous = await transaction.jobRawJob.findUnique({
        where: {
          sourceId_externalId: {
            sourceId: job.sourceId,
            externalId: job.externalId,
          },
        },
      });
      const previousCanonical = await transaction.job.findUnique({
        where: { canonicalFingerprint: fingerprint },
        select: { id: true },
      });
      if (previous?.jobId && !detailFetched) {
        const canonical = await transaction.job.update({
          where: { id: previous.jobId },
          data: { lastSeenAt: now },
        });
        await transaction.jobRawJob.update({
          where: { id: previous.id },
          data: {
            listingUrl: listing.originalUrl,
            listingHash,
            rawListing: json(listing.raw),
            lastSeenAt: now,
          },
        });
        await upsertJobSourceReference(transaction, {
          jobId: canonical.id,
          sourceId: listing.sourceId,
          externalId: listing.externalId,
          sourceUrl: listing.originalUrl,
          canonicalApplicationUrl: listing.canonicalApplicationUrl ?? null,
          lastSeenAt: now,
        });
        return {
          job: canonical,
          isNew: false,
          changed: previous.listingHash !== listingHash,
          contentHash: canonical.contentHash,
        };
      }
      const canonical = await transaction.job.upsert({
        where: { canonicalFingerprint: fingerprint },
        create: {
          canonicalFingerprint: fingerprint,
          title: job.title,
          normalizedTitle: normalizeText(job.title),
          company: job.company,
          normalizedCompany: normalizeText(job.company),
          description: job.description,
          shortDescription: job.shortDescription ?? null,
          location: job.location ?? null,
          country: job.country ?? null,
          city: job.city ?? null,
          workMode: job.workMode,
          remoteRegions: job.remoteRegions,
          salaryMin: job.salaryMin ?? null,
          salaryMax: job.salaryMax ?? null,
          salaryCurrency: job.salaryCurrency ?? null,
          salaryPeriod: job.salaryPeriod ?? null,
          contractType: job.contractType ?? null,
          seniority: job.seniority ?? null,
          technologyStack: job.technologyStack,
          originalUrl: job.originalUrl,
          canonicalApplicationUrl: job.canonicalApplicationUrl ?? null,
          publishedAt: job.publishedAt ?? null,
          lastDetailFetchedAt: detailFetched ? now : null,
          contentHash,
        },
        update: {
          title: job.title,
          normalizedTitle: normalizeText(job.title),
          company: job.company,
          normalizedCompany: normalizeText(job.company),
          description: job.description,
          shortDescription: job.shortDescription ?? null,
          location: job.location ?? null,
          country: job.country ?? null,
          city: job.city ?? null,
          workMode: job.workMode,
          remoteRegions: job.remoteRegions,
          salaryMin: job.salaryMin ?? null,
          salaryMax: job.salaryMax ?? null,
          salaryCurrency: job.salaryCurrency ?? null,
          salaryPeriod: job.salaryPeriod ?? null,
          contractType: job.contractType ?? null,
          seniority: job.seniority ?? null,
          technologyStack: job.technologyStack,
          originalUrl: job.originalUrl,
          canonicalApplicationUrl: job.canonicalApplicationUrl ?? null,
          publishedAt: job.publishedAt ?? null,
          lastSeenAt: now,
          ...(detailFetched ? { lastDetailFetchedAt: now } : {}),
          contentHash,
        },
      });
      await transaction.jobRawJob.upsert({
        where: {
          sourceId_externalId: {
            sourceId: job.sourceId,
            externalId: job.externalId,
          },
        },
        create: {
          sourceId: job.sourceId,
          externalId: job.externalId,
          jobId: canonical.id,
          listingUrl: listing.originalUrl,
          listingHash,
          detailHash: contentHash,
          contentHash,
          rawListing: json(listing.raw),
          rawDetail: detailFetched ? json(job.raw) : Prisma.JsonNull,
          lastDetailFetchedAt: detailFetched ? now : null,
        },
        update: {
          jobId: canonical.id,
          listingUrl: listing.originalUrl,
          listingHash,
          detailHash: contentHash,
          contentHash,
          rawListing: json(listing.raw),
          ...(detailFetched ? { rawDetail: json(job.raw) } : {}),
          lastSeenAt: now,
          ...(detailFetched ? { lastDetailFetchedAt: now } : {}),
        },
      });
      await upsertJobSourceReference(transaction, {
        jobId: canonical.id,
        sourceId: job.sourceId,
        externalId: job.externalId,
        sourceUrl: job.originalUrl,
        canonicalApplicationUrl: job.canonicalApplicationUrl ?? null,
        lastSeenAt: now,
      });
      await transaction.jobApplication.upsert({
        where: { jobId: canonical.id },
        create: { jobId: canonical.id },
        update: {},
      });
      if (detailFetched) {
        await transaction.jobRequirement.deleteMany({
          where: { jobId: canonical.id },
        });
        const requirements = extractJobRequirements(job.description);
        if (requirements.length > 0) {
          await transaction.jobRequirement.createMany({
            data: requirements.map((requirement) => ({
              jobId: canonical.id,
              ...requirement,
            })),
          });
        }
      }
      return {
        job: canonical,
        isNew: previousCanonical === null,
        changed: previous?.contentHash !== contentHash,
        contentHash,
      };
    });
  }

  public async saveEvaluation(input: {
    jobId: string;
    profileId: string;
    profileVersion: number;
    jobContentHash: string;
    result: JobEvaluationResult;
    ai?: JobAiMetadata;
  }) {
    const evaluation = await this.db.jobEvaluation.upsert({
      where: {
        jobId_profileId: { jobId: input.jobId, profileId: input.profileId },
      },
      create: {
        jobId: input.jobId,
        profileId: input.profileId,
        profileVersion: input.profileVersion,
        jobContentHash: input.jobContentHash,
        score: input.result.score,
        eligibility: JobEligibilityState[input.result.eligibility],
        recommendation: JobRecommendationLevel[input.result.recommendation],
        matchingSkills: input.result.matchingSkills,
        missingSkills: input.result.missingSkills,
        hardBlockers: input.result.hardBlockers,
        uncertainties: input.result.uncertainties,
        reasoning: input.result.reasoning,
        scoreBreakdown: json(input.result.scoreBreakdown),
        aiProvider: input.ai?.provider ?? null,
        aiModel: input.ai?.model ?? null,
        promptVersion: input.ai?.promptVersion ?? null,
        tokenUsage: input.ai?.tokenUsage
          ? json(input.ai.tokenUsage)
          : Prisma.JsonNull,
        estimatedCostUsd: input.ai?.estimatedCostUsd ?? null,
      },
      update: {
        profileVersion: input.profileVersion,
        jobContentHash: input.jobContentHash,
        score: input.result.score,
        eligibility: JobEligibilityState[input.result.eligibility],
        recommendation: JobRecommendationLevel[input.result.recommendation],
        matchingSkills: input.result.matchingSkills,
        missingSkills: input.result.missingSkills,
        hardBlockers: input.result.hardBlockers,
        uncertainties: input.result.uncertainties,
        reasoning: input.result.reasoning,
        scoreBreakdown: json(input.result.scoreBreakdown),
        aiProvider: input.ai?.provider ?? null,
        aiModel: input.ai?.model ?? null,
        promptVersion: input.ai?.promptVersion ?? null,
        tokenUsage: input.ai?.tokenUsage
          ? json(input.ai.tokenUsage)
          : Prisma.JsonNull,
        estimatedCostUsd: input.ai?.estimatedCostUsd ?? null,
        evaluatedAt: new Date(),
      },
    });
    await this.db.jobEvaluationVersion.upsert({
      where: {
        evaluationId_profileVersion_jobContentHash: {
          evaluationId: evaluation.id,
          profileVersion: input.profileVersion,
          jobContentHash: input.jobContentHash,
        },
      },
      create: {
        evaluationId: evaluation.id,
        profileVersion: input.profileVersion,
        jobContentHash: input.jobContentHash,
        result: json({ result: input.result, ai: input.ai ?? null }),
      },
      update: { result: json({ result: input.result, ai: input.ai ?? null }) },
    });
    return evaluation;
  }

  public findEvaluation(jobId: string, profileId: string) {
    return this.db.jobEvaluation.findUnique({
      where: { jobId_profileId: { jobId, profileId } },
    });
  }

  public updateAvailability(
    jobId: string,
    status:
      'OPEN_CONFIRMED' | 'LISTED_UNVERIFIED' | 'CLOSED_CONFIRMED' | 'UNKNOWN',
    now = new Date(),
  ) {
    return this.db.job.update({
      where: { id: jobId },
      data: { availabilityStatus: status, lastAvailabilityCheckAt: now },
    });
  }

  public async reserveNotification(input: {
    jobId: string;
    evaluationId: string;
    key: string;
    baseline: boolean;
  }) {
    try {
      const row = await this.db.jobNotification.create({
        data: {
          jobId: input.jobId,
          evaluationId: input.evaluationId,
          notificationKey: input.key,
          status: input.baseline
            ? JobNotificationStatus.SKIPPED
            : JobNotificationStatus.PENDING,
        },
      });
      return { row, reserved: true };
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error;
      }
      const row = await this.db.jobNotification.findUniqueOrThrow({
        where: { notificationKey: input.key },
      });
      return { row, reserved: false };
    }
  }

  public markNotification(id: string, sent: boolean, error?: string) {
    return this.db.jobNotification.update({
      where: { id },
      data: {
        status: sent
          ? JobNotificationStatus.SENT
          : JobNotificationStatus.FAILED,
        sentAt: sent ? new Date() : null,
        lastError: error ?? null,
      },
    });
  }

  public recordNotificationDelivery(input: {
    notificationId: string;
    provider: string;
    recipient: string;
    sent: boolean;
    error?: string;
  }) {
    const status = input.sent
      ? JobNotificationStatus.SENT
      : JobNotificationStatus.FAILED;
    return this.db.jobNotificationDelivery.upsert({
      where: {
        notificationId_provider_recipient: {
          notificationId: input.notificationId,
          provider: input.provider,
          recipient: input.recipient,
        },
      },
      create: {
        notificationId: input.notificationId,
        provider: input.provider,
        recipient: input.recipient,
        status,
        attempts: 1,
        deliveredAt: input.sent ? new Date() : null,
        lastError: input.error ?? null,
      },
      update: {
        status,
        attempts: { increment: 1 },
        deliveredAt: input.sent ? new Date() : null,
        lastError: input.error ?? null,
      },
    });
  }

  public listJobs(input?: {
    query?: string;
    status?: keyof typeof JobApplicationStatus;
    minimumScore?: number;
    take?: number;
  }) {
    const query = input?.query?.trim();
    return this.db.job.findMany({
      where: {
        ...(query
          ? {
              OR: [
                { title: { contains: query, mode: 'insensitive' as const } },
                { company: { contains: query, mode: 'insensitive' as const } },
              ],
            }
          : {}),
        ...(input?.status
          ? { application: { status: JobApplicationStatus[input.status] } }
          : {}),
        ...(input?.minimumScore === undefined
          ? {}
          : { evaluations: { some: { score: { gte: input.minimumScore } } } }),
      },
      include: {
        evaluations: { orderBy: { evaluatedAt: 'desc' }, take: 1 },
        application: true,
        sourceReferences: { include: { source: true } },
      },
      orderBy: [{ publishedAt: 'desc' }, { firstSeenAt: 'desc' }],
      take: input?.take ?? 100,
    });
  }

  public getJob(id: string) {
    return this.db.job.findUnique({
      where: { id },
      include: {
        evaluations: {
          include: { versions: { orderBy: { evaluatedAt: 'desc' } } },
          orderBy: { evaluatedAt: 'desc' },
        },
        application: { include: { notes: { orderBy: { createdAt: 'desc' } } } },
        sourceReferences: { include: { source: true } },
        requirements: true,
      },
    });
  }

  public getOverview() {
    return Promise.all([
      this.db.job.count(),
      this.db.job.count({ where: { application: { unread: true } } }),
      this.db.jobEvaluation.count({ where: { score: { gte: 70 } } }),
      this.db.jobApplication.groupBy({ by: ['status'], _count: true }),
      this.db.jobScrapeRun.findFirst({ orderBy: { startedAt: 'desc' } }),
      this.listSources(),
    ]);
  }

  public updateApplication(
    jobId: string,
    input: {
      status?: keyof typeof JobApplicationStatus;
      unread?: boolean;
      saved?: boolean;
      followUpAt?: Date | null;
      note?: string;
    },
  ) {
    return this.db.$transaction(async (transaction) => {
      const application = await transaction.jobApplication.upsert({
        where: { jobId },
        create: {
          jobId,
          ...(input.status
            ? { status: JobApplicationStatus[input.status] }
            : {}),
          unread: input.unread ?? false,
          saved: input.saved ?? false,
          ...(input.followUpAt === undefined
            ? {}
            : { followUpAt: input.followUpAt }),
          ...(input.status === 'APPLIED' ? { appliedAt: new Date() } : {}),
        },
        update: {
          ...(input.status
            ? {
                status: JobApplicationStatus[input.status],
                statusChangedAt: new Date(),
              }
            : {}),
          ...(input.unread === undefined ? {} : { unread: input.unread }),
          ...(input.saved === undefined ? {} : { saved: input.saved }),
          ...(input.followUpAt === undefined
            ? {}
            : { followUpAt: input.followUpAt }),
          ...(input.status === 'APPLIED' ? { appliedAt: new Date() } : {}),
        },
      });
      if (input.note?.trim())
        await transaction.jobApplicationNote.create({
          data: { applicationId: application.id, note: input.note.trim() },
        });
      return application;
    });
  }

  public async ensureSchedules(timezone: string, now = new Date()) {
    const schedules = [
      ['morning', '0 8 * * *'],
      ['noon', '0 12 * * *'],
      ['evening', '0 19 * * *'],
    ] as const;
    await this.db.$transaction(
      schedules.map(([scheduleKey, cron]) =>
        this.db.jobSchedule.upsert({
          where: { scheduleKey },
          create: {
            scheduleKey,
            cron,
            timezone,
            nextRunAt: computeNextRun(cron, timezone, now),
          },
          update: { cron, timezone },
        }),
      ),
    );
  }

  public listSchedules() {
    return this.db.jobSchedule.findMany({ orderBy: { nextRunAt: 'asc' } });
  }

  public async claimDueSchedule(now = new Date(), leaseMs = 30 * 60_000) {
    const due = await this.db.jobSchedule.findFirst({
      where: {
        enabled: true,
        nextRunAt: { lte: now },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      orderBy: { nextRunAt: 'asc' },
    });
    if (!due) return undefined;
    const claimed = await this.db.jobSchedule.updateMany({
      where: {
        id: due.id,
        nextRunAt: due.nextRunAt,
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      data: { claimedAt: now, leaseUntil: new Date(now.getTime() + leaseMs) },
    });
    return claimed.count === 1 ? due : undefined;
  }

  public completeSchedule(
    id: string,
    cron: string,
    timezone: string,
    status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'SKIPPED',
    now = new Date(),
  ) {
    return this.db.jobSchedule.update({
      where: { id },
      data: {
        nextRunAt: computeNextRun(cron, timezone, now),
        lastRunAt: now,
        lastStatus: RunStatus[status],
        claimedAt: null,
        leaseUntil: null,
      },
    });
  }

  public queueManualRun(now = new Date()) {
    return this.db.jobSchedule.updateMany({
      where: { scheduleKey: 'morning' },
      data: { nextRunAt: now },
    });
  }
}
