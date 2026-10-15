import { createHash } from 'node:crypto';
import { computeNextRun } from '@watcher/core';
import type { DatabaseClient } from './client.js';
import type { Prisma } from './generated/prisma/client.js';
import {
  SocialBusinessObjective,
  SocialContentFormat,
  SocialCzechMarketStatus,
  SocialTrendFeedbackKind,
  SocialTrendRegion,
  SocialTrendRunStatus,
  SocialTrendSourceAvailability,
  SocialTrendSourceKind,
  SocialTrendStage,
  SocialChannel,
} from './generated/prisma/enums.js';
import { normalizeSocialText } from './socials-store.js';

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

const defaultScoringWeights = {
  usMomentum: 25,
  czechOpportunity: 25,
  audienceRelevance: 20,
  businessPotential: 15,
  contentFeasibility: 10,
  evidenceQuality: 5,
};

const defaultQuotaLimits = { youtubeSearchesPerDay: 8, youtubeReadsPerDay: 40 };

export type StoredTrendSignal = {
  source: keyof typeof SocialTrendSourceKind;
  externalId: string;
  fingerprint: string;
  sourceUrl: string;
  title: string;
  description?: string | undefined;
  author?: string | undefined;
  keywords?: readonly string[] | undefined;
  region: keyof typeof SocialTrendRegion;
  publishedAt?: Date | undefined;
  collectedAt: Date;
  metrics: {
    views?: number | undefined;
    likes?: number | undefined;
    comments?: number | undefined;
    shares?: number | undefined;
    searchInterest?: number | undefined;
  };
  metadata?: Record<string, unknown> | undefined;
};

export type StoredTrendOpportunity = {
  ownerUserId: bigint;
  runId: string;
  clusterId: string;
  fingerprint: string;
  title: string;
  description: string;
  czechMarketStatus: keyof typeof SocialCzechMarketStatus;
  opportunityScore: number;
  confidence: number;
  factors: {
    usMomentum: number;
    czechOpportunity: number;
    audienceRelevance: number;
    businessPotential: number;
    contentFeasibility: number;
    evidenceQuality: number;
  };
  missingData: readonly string[];
  explanation: string;
  evidence: unknown;
  contentConcept: unknown;
  recommendedChannel: keyof typeof SocialChannel;
  recommendedFormat: keyof typeof SocialContentFormat;
  objective: keyof typeof SocialBusinessObjective;
  estimatedEffortMinutes: number;
};

export class SocialTrendStore {
  public constructor(private readonly db: DatabaseClient) {}

  public ensureProfile(
    ownerUserId: bigint,
    now = new Date(),
    defaults?: {
      enabled: boolean;
      schedule: string;
      timezone: string;
      reportSize: number;
      enabledSources: readonly (keyof typeof SocialTrendSourceKind)[];
    },
  ) {
    const schedule = defaults?.schedule ?? '0 7 * * *';
    const timezone = defaults?.timezone ?? 'Europe/Prague';
    return this.db.socialTrendProfile.upsert({
      where: { ownerUserId },
      create: {
        ownerUserId,
        enabled: defaults?.enabled ?? true,
        schedule,
        timezone,
        reportSize: defaults?.reportSize ?? 5,
        enabledSources: defaults?.enabledSources.map(
          (source) => SocialTrendSourceKind[source],
        ) ?? [SocialTrendSourceKind.REDDIT, SocialTrendSourceKind.YOUTUBE],
        scoringWeights: json(defaultScoringWeights),
        quotaLimits: json(defaultQuotaLimits),
        nextRunAt: computeNextRun(schedule, timezone, now),
      },
      update: {},
    });
  }

  public listEnabledProfiles() {
    return this.db.socialTrendProfile.findMany({
      where: { enabled: true },
      orderBy: { ownerUserId: 'asc' },
    });
  }

  public updateProfile(
    ownerUserId: bigint,
    input: {
      enabled?: boolean;
      schedule?: string;
      timezone?: string;
      reportSize?: number;
      keywords?: readonly string[];
      subreddits?: readonly string[];
      enabledSources?: readonly (keyof typeof SocialTrendSourceKind)[];
      scoringWeights?: typeof defaultScoringWeights;
      quotaLimits?: typeof defaultQuotaLimits;
    },
    now = new Date(),
  ) {
    const schedule = input.schedule;
    const timezone = input.timezone;
    return this.db.socialTrendProfile.update({
      where: { ownerUserId },
      data: {
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(schedule ? { schedule } : {}),
        ...(timezone ? { timezone } : {}),
        ...(input.reportSize === undefined
          ? {}
          : { reportSize: input.reportSize }),
        ...(input.keywords ? { keywords: [...input.keywords] } : {}),
        ...(input.subreddits ? { subreddits: [...input.subreddits] } : {}),
        ...(input.enabledSources
          ? {
              enabledSources: input.enabledSources.map(
                (source) => SocialTrendSourceKind[source],
              ),
            }
          : {}),
        ...(input.scoringWeights
          ? { scoringWeights: json(input.scoringWeights) }
          : {}),
        ...(input.quotaLimits ? { quotaLimits: json(input.quotaLimits) } : {}),
        ...(schedule || timezone
          ? {
              nextRunAt: computeNextRun(
                schedule ?? '0 7 * * *',
                timezone ?? 'Europe/Prague',
                now,
              ),
            }
          : {}),
      },
    });
  }

  public sourceConfigs(ownerUserId: bigint) {
    return this.db.socialTrendSourceConfig.findMany({
      where: { ownerUserId },
      orderBy: { source: 'asc' },
    });
  }

  public configureSource(input: {
    ownerUserId: bigint;
    source: keyof typeof SocialTrendSourceKind;
    enabled: boolean;
    availability: keyof typeof SocialTrendSourceAvailability;
    config?: unknown;
    error?: string;
  }) {
    return this.db.socialTrendSourceConfig.upsert({
      where: {
        ownerUserId_source: {
          ownerUserId: input.ownerUserId,
          source: SocialTrendSourceKind[input.source],
        },
      },
      create: {
        ownerUserId: input.ownerUserId,
        source: SocialTrendSourceKind[input.source],
        enabled: input.enabled,
        availability: SocialTrendSourceAvailability[input.availability],
        config: json(input.config ?? {}),
        lastError: input.error ?? null,
      },
      update: {
        enabled: input.enabled,
        availability: SocialTrendSourceAvailability[input.availability],
        config: json(input.config ?? {}),
        lastError: input.error ?? null,
      },
    });
  }

  public async startRun(input: {
    ownerUserId: bigint;
    chatId: bigint;
    idempotencyKey: string;
    trigger: string;
    requestedSources: readonly (keyof typeof SocialTrendSourceKind)[];
  }) {
    const existing = await this.db.socialTrendResearchRun.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { report: true },
    });
    if (existing) {
      const staleRunning =
        existing.status === 'RUNNING' &&
        existing.startedAt.getTime() < Date.now() - 30 * 60_000;
      if (existing.status === 'FAILED' || staleRunning) {
        const run = await this.db.socialTrendResearchRun.update({
          where: { id: existing.id },
          data: {
            status: 'RUNNING',
            startedAt: new Date(),
            finishedAt: null,
            error: null,
          },
          include: { report: true },
        });
        return { run, claimed: true as const };
      }
      return { run: existing, claimed: false as const };
    }
    try {
      const run = await this.db.socialTrendResearchRun.create({
        data: {
          ownerUserId: input.ownerUserId,
          chatId: input.chatId,
          idempotencyKey: input.idempotencyKey,
          trigger: input.trigger,
          requestedSources: input.requestedSources.map(
            (source) => SocialTrendSourceKind[source],
          ),
        },
        include: { report: true },
      });
      return { run, claimed: true as const };
    } catch (error) {
      const raced = await this.db.socialTrendResearchRun.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { report: true },
      });
      if (raced) return { run: raced, claimed: false as const };
      throw error;
    }
  }

  public finishRun(input: {
    runId: string;
    status: keyof typeof SocialTrendRunStatus;
    signalCount: number;
    clusterCount: number;
    opportunityCount: number;
    sourceFailures: number;
    error?: string;
    now?: Date;
  }) {
    return this.db.socialTrendResearchRun.update({
      where: { id: input.runId },
      data: {
        status: SocialTrendRunStatus[input.status],
        finishedAt: input.now ?? new Date(),
        signalCount: input.signalCount,
        clusterCount: input.clusterCount,
        opportunityCount: input.opportunityCount,
        sourceFailures: input.sourceFailures,
        error: input.error ?? null,
      },
    });
  }

  public async markProfileRun(
    ownerUserId: bigint,
    schedule: string,
    timezone: string,
    now = new Date(),
  ) {
    return this.db.socialTrendProfile.update({
      where: { ownerUserId },
      data: {
        lastRunAt: now,
        nextRunAt: computeNextRun(schedule, timezone, now),
      },
    });
  }

  public async recordSourceRun(input: {
    runId: string;
    ownerUserId: bigint;
    source: keyof typeof SocialTrendSourceKind;
    status: keyof typeof SocialTrendSourceAvailability;
    itemCount: number;
    quotaUsed: number;
    durationMs: number;
    error?: string;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    await this.db.$transaction([
      this.db.socialTrendSourceRun.upsert({
        where: {
          runId_source: {
            runId: input.runId,
            source: SocialTrendSourceKind[input.source],
          },
        },
        create: {
          runId: input.runId,
          source: SocialTrendSourceKind[input.source],
          status: SocialTrendSourceAvailability[input.status],
          itemCount: input.itemCount,
          quotaUsed: input.quotaUsed,
          durationMs: input.durationMs,
          error: input.error ?? null,
        },
        update: {
          status: SocialTrendSourceAvailability[input.status],
          itemCount: input.itemCount,
          quotaUsed: input.quotaUsed,
          durationMs: input.durationMs,
          error: input.error ?? null,
        },
      }),
      this.db.socialTrendSourceConfig.upsert({
        where: {
          ownerUserId_source: {
            ownerUserId: input.ownerUserId,
            source: SocialTrendSourceKind[input.source],
          },
        },
        create: {
          ownerUserId: input.ownerUserId,
          source: SocialTrendSourceKind[input.source],
          enabled: true,
          availability: SocialTrendSourceAvailability[input.status],
          config: json({}),
          lastAttemptAt: now,
          lastSuccessfulAt: input.status === 'ACTIVE' ? now : null,
          lastError: input.error ?? null,
          quotaUsed: input.quotaUsed,
          quotaDate: now,
        },
        update: {
          availability: SocialTrendSourceAvailability[input.status],
          lastAttemptAt: now,
          ...(input.status === 'ACTIVE' ? { lastSuccessfulAt: now } : {}),
          lastError: input.error ?? null,
          quotaUsed: input.quotaUsed,
          quotaDate: now,
        },
      }),
    ]);
  }

  public async upsertSignal(ownerUserId: bigint, input: StoredTrendSignal) {
    const signal = await this.db.socialTrendSignal.upsert({
      where: {
        ownerUserId_source_externalId: {
          ownerUserId,
          source: SocialTrendSourceKind[input.source],
          externalId: input.externalId,
        },
      },
      create: {
        ownerUserId,
        source: SocialTrendSourceKind[input.source],
        externalId: input.externalId,
        fingerprint: input.fingerprint,
        sourceUrl: input.sourceUrl,
        title: input.title,
        description: input.description ?? null,
        author: input.author ?? null,
        keywords: [...(input.keywords ?? [])],
        region: SocialTrendRegion[input.region],
        publishedAt: input.publishedAt ?? null,
        firstSeenAt: input.collectedAt,
        lastSeenAt: input.collectedAt,
        collectedAt: input.collectedAt,
        metrics: json(input.metrics),
        metadata: json(input.metadata ?? {}),
      },
      update: {
        sourceUrl: input.sourceUrl,
        title: input.title,
        description: input.description ?? null,
        author: input.author ?? null,
        keywords: [...(input.keywords ?? [])],
        publishedAt: input.publishedAt ?? null,
        lastSeenAt: input.collectedAt,
        collectedAt: input.collectedAt,
        metrics: json(input.metrics),
        metadata: json(input.metadata ?? {}),
      },
    });
    await this.db.socialTrendObservation.create({
      data: {
        signalId: signal.id,
        observedAt: input.collectedAt,
        views: input.metrics.views ?? null,
        likes: input.metrics.likes ?? null,
        comments: input.metrics.comments ?? null,
        shares: input.metrics.shares ?? null,
        searchInterest: input.metrics.searchInterest ?? null,
        metrics: json(input.metrics),
      },
    });
    return signal;
  }

  public signalHistory(ownerUserId: bigint, signalIds: readonly string[]) {
    return this.db.socialTrendSignal.findMany({
      where: { ownerUserId, id: { in: [...signalIds] } },
      include: { observations: { orderBy: { observedAt: 'asc' }, take: 30 } },
    });
  }

  public async upsertCluster(input: {
    ownerUserId: bigint;
    canonicalKey: string;
    title: string;
    description?: string;
    keywords: readonly string[];
    stage: keyof typeof SocialTrendStage;
    signalIds: readonly string[];
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const cluster = await this.db.socialTrendCluster.upsert({
      where: {
        ownerUserId_canonicalKey: {
          ownerUserId: input.ownerUserId,
          canonicalKey: input.canonicalKey,
        },
      },
      create: {
        ownerUserId: input.ownerUserId,
        canonicalKey: input.canonicalKey,
        title: input.title,
        description: input.description ?? null,
        keywords: [...input.keywords],
        stage: SocialTrendStage[input.stage],
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: {
        title: input.title,
        description: input.description ?? null,
        keywords: [...input.keywords],
        stage: SocialTrendStage[input.stage],
        lastSeenAt: now,
      },
    });
    await this.db.socialTrendSignal.updateMany({
      where: {
        ownerUserId: input.ownerUserId,
        id: { in: [...input.signalIds] },
      },
      data: { clusterId: cluster.id },
    });
    return this.db.socialTrendCluster.findUniqueOrThrow({
      where: { id: cluster.id },
      include: {
        signals: {
          include: { observations: { orderBy: { observedAt: 'asc' } } },
        },
      },
    });
  }

  public createMarketComparison(input: {
    clusterId: string;
    status: keyof typeof SocialCzechMarketStatus;
    usEvidence: unknown;
    czEvidence: unknown;
    explanation: string;
    confidence: number;
    missingData: readonly string[];
    researchedAt?: Date;
  }) {
    return this.db.socialTrendMarketComparison.create({
      data: {
        clusterId: input.clusterId,
        status: SocialCzechMarketStatus[input.status],
        usEvidence: json(input.usEvidence),
        czEvidence: json(input.czEvidence),
        explanation: input.explanation,
        confidence: input.confidence,
        missingData: [...input.missingData],
        researchedAt: input.researchedAt ?? new Date(),
      },
    });
  }

  public upsertOpportunity(input: StoredTrendOpportunity) {
    const data = {
      title: input.title,
      description: input.description,
      czechMarketStatus: SocialCzechMarketStatus[input.czechMarketStatus],
      opportunityScore: input.opportunityScore,
      confidence: input.confidence,
      usMomentumScore: input.factors.usMomentum,
      czechOpportunityScore: input.factors.czechOpportunity,
      audienceRelevanceScore: input.factors.audienceRelevance,
      businessPotentialScore: input.factors.businessPotential,
      contentFeasibilityScore: input.factors.contentFeasibility,
      evidenceQualityScore: input.factors.evidenceQuality,
      missingData: [...input.missingData],
      explanation: input.explanation,
      evidence: json(input.evidence),
      contentConcept: json(input.contentConcept),
      recommendedChannel: SocialChannel[input.recommendedChannel],
      recommendedFormat: SocialContentFormat[input.recommendedFormat],
      objective: SocialBusinessObjective[input.objective],
      estimatedEffortMinutes: input.estimatedEffortMinutes,
    };
    return this.db.socialTrendOpportunity.upsert({
      where: { fingerprint: input.fingerprint },
      create: {
        ...data,
        ownerUserId: input.ownerUserId,
        runId: input.runId,
        clusterId: input.clusterId,
        fingerprint: input.fingerprint,
      },
      update: data,
    });
  }

  public saveReport(input: {
    ownerUserId: bigint;
    runId: string;
    researchDate: Date;
    text: string;
    report: unknown;
  }) {
    const contentHash = createHash('sha256').update(input.text).digest('hex');
    return this.db.socialTrendReport.upsert({
      where: { runId: input.runId },
      create: {
        ownerUserId: input.ownerUserId,
        runId: input.runId,
        researchDate: input.researchDate,
        contentHash,
        text: input.text,
        report: json(input.report),
      },
      update: { text: input.text, report: json(input.report), contentHash },
    });
  }

  public latestReport(ownerUserId: bigint) {
    return this.db.socialTrendReport.findFirst({
      where: { ownerUserId },
      include: {
        run: {
          include: {
            sourceRuns: true,
            opportunities: {
              include: {
                cluster: {
                  include: {
                    signals: true,
                    comparisons: { orderBy: { researchedAt: 'desc' }, take: 1 },
                  },
                },
                feedback: true,
              },
              orderBy: [{ opportunityScore: 'desc' }, { confidence: 'desc' }],
            },
          },
        },
      },
      orderBy: [{ researchDate: 'desc' }, { createdAt: 'desc' }],
    });
  }

  public listOpportunities(ownerUserId: bigint, limit = 30) {
    return this.db.socialTrendOpportunity.findMany({
      where: { ownerUserId },
      include: {
        cluster: {
          include: {
            signals: true,
            comparisons: { orderBy: { researchedAt: 'desc' }, take: 1 },
          },
        },
        feedback: true,
        contentIdea: true,
      },
      orderBy: [{ opportunityScore: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });
  }

  public opportunity(ownerUserId: bigint, id: string) {
    return this.db.socialTrendOpportunity.findFirst({
      where: { id, ownerUserId },
      include: {
        cluster: {
          include: {
            signals: {
              include: { observations: { orderBy: { observedAt: 'asc' } } },
            },
            comparisons: { orderBy: { researchedAt: 'desc' }, take: 10 },
          },
        },
        feedback: { orderBy: { createdAt: 'desc' } },
        contentIdea: true,
      },
    });
  }

  public addFeedback(input: {
    ownerUserId: bigint;
    opportunityId: string;
    kind: keyof typeof SocialTrendFeedbackKind;
    notes?: string;
  }) {
    return this.db.socialTrendFeedback.create({
      data: {
        ownerUserId: input.ownerUserId,
        opportunityId: input.opportunityId,
        kind: SocialTrendFeedbackKind[input.kind],
        notes: input.notes ?? null,
      },
    });
  }

  public async convertOpportunityToIdea(
    ownerUserId: bigint,
    opportunityId: string,
  ) {
    return this.db.$transaction(async (transaction) => {
      const opportunity = await transaction.socialTrendOpportunity.findFirst({
        where: { id: opportunityId, ownerUserId },
        include: { contentIdea: true },
      });
      if (!opportunity) throw new Error('Trend opportunity not found');
      if (opportunity.contentIdea) return opportunity.contentIdea;
      const normalizedTitle = normalizeSocialText(opportunity.title);
      const existing = await transaction.socialContentIdea.findUnique({
        where: {
          ownerUserId_normalizedTitle: { ownerUserId, normalizedTitle },
        },
      });
      const idea =
        existing ??
        (await transaction.socialContentIdea.create({
          data: {
            ownerUserId,
            title: opportunity.title,
            normalizedTitle,
            description: opportunity.description,
            sourceType: 'TREND_INTELLIGENCE',
            sourceReference: opportunity.id,
            businessObjective: opportunity.objective,
            priority: opportunity.opportunityScore >= 75 ? 'HIGH' : 'MEDIUM',
          },
        }));
      await transaction.socialTrendOpportunity.update({
        where: { id: opportunity.id },
        data: { contentIdeaId: idea.id },
      });
      return idea;
    });
  }

  public feedbackAdjustments(ownerUserId: bigint) {
    return this.db.socialTrendFeedback.groupBy({
      by: ['kind'],
      where: { ownerUserId },
      _count: { _all: true },
    });
  }

  public async clusterLearning(ownerUserId: bigint, canonicalKey: string) {
    const opportunities = await this.db.socialTrendOpportunity.findMany({
      where: { ownerUserId, cluster: { canonicalKey } },
      include: {
        feedback: true,
        contentIdea: {
          include: {
            contentItems: { include: { metrics: true } },
          },
        },
      },
      take: 50,
    });
    const feedback = opportunities.flatMap(
      (opportunity) => opportunity.feedback,
    );
    const metrics = opportunities.flatMap(
      (opportunity) =>
        opportunity.contentIdea?.contentItems.flatMap((item) => item.metrics) ??
        [],
    );
    return {
      positive: feedback.filter(({ kind }) =>
        ['RELEVANT', 'GOOD_IDEA', 'PUBLISHED', 'GENERATED_LEADS'].includes(
          kind,
        ),
      ).length,
      negative: feedback.filter(({ kind }) => kind === 'NOT_RELEVANT').length,
      saturated: feedback.filter(({ kind }) => kind === 'ALREADY_SATURATED')
        .length,
      publishedItems: opportunities.reduce(
        (sum, opportunity) =>
          sum +
          (opportunity.contentIdea?.contentItems.filter(
            ({ status }) => status === 'PUBLISHED',
          ).length ?? 0),
        0,
      ),
      qualifiedLeads: metrics.reduce(
        (sum, metric) => sum + (metric.qualifiedLeads ?? 0),
        0,
      ),
    };
  }

  public async cleanup(
    ownerUserId: bigint,
    retentionDays: number,
    now = new Date(),
  ) {
    const before = new Date(now.getTime() - retentionDays * 24 * 60 * 60_000);
    return this.db.socialTrendSignal.deleteMany({
      where: {
        ownerUserId,
        lastSeenAt: { lt: before },
        cluster: { opportunities: { none: {} } },
      },
    });
  }
}
