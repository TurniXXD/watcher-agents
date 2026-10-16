import { createHash } from 'node:crypto';
import type { DatabaseClient } from './client.js';
import type { Prisma } from './generated/prisma/client.js';
import {
  SocialAttendanceStatus,
  SocialContentStatus,
  SocialFollowUpStatus,
  SocialSchedulerStatus,
  SocialVersionSource,
  SocialWeeklyPlanStatus,
} from './generated/prisma/enums.js';

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export const normalizeSocialText = (value: string): string =>
  value
    .normalize('NFKD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('cs-CZ')
    .replaceAll(/[^a-z0-9]+/gu, ' ')
    .trim();

export const socialSlug = (value: string): string =>
  normalizeSocialText(value).replaceAll(/\s+/gu, '-').slice(0, 80);

const defaultCadence = {
  linkedin: [
    { weekday: 1, time: '09:00', format: 'TEXT_POST' },
    { weekday: 4, time: '09:00', format: 'TEXT_POST' },
  ],
  instagram: [
    { weekday: 2, time: '18:00', format: 'REEL' },
    { weekday: 5, time: '17:00', format: 'CAROUSEL' },
  ],
  blogPerMonth: 2,
  newsletterPerMonth: 1,
};

const defaultPillars = {
  'AI a automatizace podnikání': 40,
  'Weby a digitální systémy': 25,
  'Projekty a experimenty': 25,
  'Podnikání a osobní značka': 10,
};

const defaultTopics = [
  ['AI automatizace', 'AI a automatizace podnikání'],
  ['Lokální LLM', 'AI a automatizace podnikání'],
  ['CRM integrace', 'Weby a digitální systémy'],
  ['Webový vývoj', 'Weby a digitální systémy'],
  ['Optimalizace firemních procesů', 'AI a automatizace podnikání'],
  ['Osobní podnikání', 'Podnikání a osobní značka'],
] as const;

export type SocialIdeaInput = {
  ownerUserId: bigint;
  title: string;
  description?: string;
  sourceType?: string;
  sourceReference?: string;
  topicIds?: readonly string[];
  projectIds?: readonly string[];
};

export type SocialPlanItemInput = {
  ideaId: string;
  title: string;
  channel: 'LINKEDIN' | 'INSTAGRAM' | 'BLOG' | 'NEWSLETTER';
  format:
    | 'TEXT_POST'
    | 'REEL'
    | 'CAROUSEL'
    | 'STORY'
    | 'BLOG_ARTICLE'
    | 'NEWSLETTER_ISSUE';
  contentPillar: string;
  targetAudience: string;
  objective:
    | 'QUALIFIED_LEADS'
    | 'CREDIBILITY'
    | 'PERSONAL_BRAND'
    | 'AUDIENCE_GROWTH'
    | 'TRAFFIC'
    | 'NEWSLETTER_GROWTH'
    | 'LEARNING';
  angle: string;
  planningReason: string;
  similarityWarning?: string;
  hook?: string;
  cta?: string;
  requiredAssets?: readonly string[];
  plannedAt: Date;
  estimatedPreparationMinutes: number;
  topicIds?: readonly string[];
  projectIds?: readonly string[];
};

export class SocialsStore {
  public constructor(private readonly db: DatabaseClient) {}

  public async ensureSettings(ownerUserId: bigint, chatId: bigint) {
    const settings = await this.db.socialSettings.upsert({
      where: { ownerUserId },
      create: {
        ownerUserId,
        chatId,
        reminderPreferences: json({ preEventHours: 24, followUpDays: 2 }),
        cadence: json(defaultCadence),
        pillarDistribution: json(defaultPillars),
      },
      update: { chatId },
    });
    await Promise.all(
      defaultTopics.map(([name, pillar]) =>
        this.db.socialTopic.upsert({
          where: { ownerUserId_slug: { ownerUserId, slug: socialSlug(name) } },
          create: {
            ownerUserId,
            name,
            slug: socialSlug(name),
            pillar,
          },
          update: {},
        }),
      ),
    );
    return settings;
  }

  public updateSettings(
    ownerUserId: bigint,
    input: {
      preferredCities?: readonly string[];
      travelRadiusKm?: number;
      maximumEventPriceCzk?: number;
      weeklyRecommendationCount?: number;
      mondayNetworkingReminder?: boolean;
    },
  ) {
    return this.db.socialSettings.update({
      where: { ownerUserId },
      data: {
        ...(input.preferredCities
          ? { preferredCities: [...input.preferredCities] }
          : {}),
        ...(input.travelRadiusKm === undefined
          ? {}
          : { travelRadiusKm: input.travelRadiusKm }),
        ...(input.maximumEventPriceCzk === undefined
          ? {}
          : { maximumEventPriceCzk: input.maximumEventPriceCzk }),
        ...(input.weeklyRecommendationCount === undefined
          ? {}
          : { weeklyRecommendationCount: input.weeklyRecommendationCount }),
        ...(input.mondayNetworkingReminder === undefined
          ? {}
          : { mondayNetworkingReminder: input.mondayNetworkingReminder }),
      },
    });
  }

  public listTopics(ownerUserId: bigint) {
    return this.db.socialTopic.findMany({
      where: { ownerUserId, status: 'ACTIVE' },
      orderBy: [{ pillar: 'asc' }, { name: 'asc' }],
    });
  }

  public listProjects(ownerUserId: bigint) {
    return this.db.socialProject.findMany({
      where: { ownerUserId, status: { not: 'ARCHIVED' } },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
  }

  public createProject(input: {
    ownerUserId: bigint;
    name: string;
    description?: string;
    category?: string;
    technologies?: readonly string[];
    visibility?: 'PUBLIC' | 'PRIVATE' | 'CONFIDENTIAL';
    repositoryUrl?: string;
    websiteUrl?: string;
  }) {
    return this.db.socialProject.upsert({
      where: {
        ownerUserId_normalizedName: {
          ownerUserId: input.ownerUserId,
          normalizedName: normalizeSocialText(input.name),
        },
      },
      create: {
        ownerUserId: input.ownerUserId,
        name: input.name.trim(),
        normalizedName: normalizeSocialText(input.name),
        description: input.description?.trim() ?? null,
        category: input.category?.trim() || 'Ostatní',
        technologies: [...(input.technologies ?? [])],
        visibility: input.visibility ?? 'PRIVATE',
        repositoryUrl: input.repositoryUrl ?? null,
        websiteUrl: input.websiteUrl ?? null,
      },
      update: {
        ...(input.description ? { description: input.description.trim() } : {}),
        ...(input.technologies
          ? { technologies: [...input.technologies] }
          : {}),
        ...(input.visibility ? { visibility: input.visibility } : {}),
        ...(input.repositoryUrl ? { repositoryUrl: input.repositoryUrl } : {}),
        ...(input.websiteUrl ? { websiteUrl: input.websiteUrl } : {}),
      },
    });
  }

  public listIdeaCandidates(ownerUserId: bigint, limit = 200) {
    return this.db.socialContentIdea.findMany({
      where: { ownerUserId, status: { not: 'ARCHIVED' } },
      include: {
        topics: { include: { topic: true } },
        projects: { include: { project: true } },
        contentItems: {
          where: { status: { not: 'ARCHIVED' } },
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
  }

  public createIdea(input: SocialIdeaInput) {
    return this.db.socialContentIdea.create({
      data: {
        ownerUserId: input.ownerUserId,
        title: input.title.trim(),
        normalizedTitle: normalizeSocialText(input.title),
        description: input.description?.trim() || input.title.trim(),
        sourceType: input.sourceType ?? 'TELEGRAM',
        sourceReference: input.sourceReference ?? null,
        ...(input.topicIds?.length
          ? {
              topics: {
                create: [...new Set(input.topicIds)].map((topicId) => ({
                  topicId,
                })),
              },
            }
          : {}),
        ...(input.projectIds?.length
          ? {
              projects: {
                create: [...new Set(input.projectIds)].map((projectId) => ({
                  projectId,
                })),
              },
            }
          : {}),
      },
      include: {
        topics: { include: { topic: true } },
        projects: { include: { project: true } },
      },
    });
  }

  public listIdeas(
    ownerUserId: bigint,
    status?: 'BACKLOG' | 'PLANNED' | 'USED',
  ) {
    return this.db.socialContentIdea.findMany({
      where: { ownerUserId, ...(status ? { status } : {}) },
      include: {
        topics: { include: { topic: true } },
        projects: { include: { project: true } },
        contentItems: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
  }

  public startSession(input: {
    ownerUserId: bigint;
    chatId: bigint;
    sessionType: string;
    state: string;
    payload?: unknown;
    expiresAt: Date;
  }) {
    return this.db.$transaction(async (transaction) => {
      await transaction.socialTelegramSession.deleteMany({
        where: {
          ownerUserId: input.ownerUserId,
          chatId: input.chatId,
          sessionType: input.sessionType,
          state: { not: 'COMPLETED' },
        },
      });
      return transaction.socialTelegramSession.create({
        data: {
          ...input,
          payload: json(input.payload ?? {}),
        },
      });
    });
  }

  public activeSession(ownerUserId: bigint, chatId: bigint, now = new Date()) {
    return this.db.socialTelegramSession.findFirst({
      where: { ownerUserId, chatId, expiresAt: { gt: now } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  public updateSession(id: string, state: string, payload: unknown) {
    return this.db.socialTelegramSession.update({
      where: { id },
      data: { state, payload: json(payload) },
    });
  }

  public endSession(id: string) {
    return this.db.socialTelegramSession.delete({ where: { id } });
  }

  public completeSession(id: string, payload: unknown) {
    return this.db.socialTelegramSession.update({
      where: { id },
      data: {
        state: 'COMPLETED',
        payload: json(payload),
        expiresAt: new Date(),
      },
    });
  }

  public findWeeklyPlan(ownerUserId: bigint, weekStart: Date) {
    return this.db.socialWeeklyPlan.findFirst({
      where: { ownerUserId, weekStart },
      include: {
        contentItems: {
          include: {
            idea: true,
            topics: { include: { topic: true } },
            projects: { include: { project: true } },
            sources: { include: { source: true } },
            versions: { orderBy: { versionNumber: 'desc' }, take: 1 },
          },
          orderBy: { plannedAt: 'asc' },
        },
        checklistItems: { orderBy: { sortOrder: 'asc' } },
        packs: { orderBy: { version: 'desc' }, take: 1 },
      },
      orderBy: { version: 'desc' },
    });
  }

  public async createWeeklyPlan(input: {
    ownerUserId: bigint;
    weekStart: Date;
    weekEnd: Date;
    planningSessionId?: string;
    items: readonly SocialPlanItemInput[];
  }) {
    const existing = await this.findWeeklyPlan(
      input.ownerUserId,
      input.weekStart,
    );
    if (existing) return existing;
    await this.db.$transaction(async (transaction) => {
      const plan = await transaction.socialWeeklyPlan.create({
        data: {
          ownerUserId: input.ownerUserId,
          weekStart: input.weekStart,
          weekEnd: input.weekEnd,
          planningSessionId: input.planningSessionId ?? null,
        },
      });
      const createdItems = [];
      for (const item of input.items) {
        const created = await transaction.socialContentItem.create({
          data: {
            ownerUserId: input.ownerUserId,
            weeklyPlanId: plan.id,
            ideaId: item.ideaId,
            title: item.title,
            channel: item.channel,
            format: item.format,
            contentPillar: item.contentPillar,
            targetAudience: item.targetAudience,
            objective: item.objective,
            angle: item.angle,
            planningReason: item.planningReason,
            similarityWarning: item.similarityWarning ?? null,
            hook: item.hook ?? null,
            cta: item.cta ?? null,
            requiredAssets: [...(item.requiredAssets ?? [])],
            plannedAt: item.plannedAt,
            status: 'PLANNED',
            estimatedPreparationMinutes: item.estimatedPreparationMinutes,
            ...(item.topicIds?.length
              ? {
                  topics: {
                    create: [...new Set(item.topicIds)].map((topicId) => ({
                      topicId,
                    })),
                  },
                }
              : {}),
            ...(item.projectIds?.length
              ? {
                  projects: {
                    create: [...new Set(item.projectIds)].map((projectId) => ({
                      projectId,
                    })),
                  },
                }
              : {}),
          },
        });
        createdItems.push(created);
        await transaction.socialContentIdea.update({
          where: { id: item.ideaId },
          data: { status: 'PLANNED' },
        });
      }
      const checklist = [
        ['Schválit týdenní plán', null],
        ['Exportovat prompty pro ChatGPT', null],
        ...createdItems.map((item) => [`Připravit: ${item.title}`, item.id]),
        ['Naplánovat schválené příspěvky v platformách', null],
        ['Potvrdit naplánování v databázi', null],
      ] as const;
      await transaction.socialChecklistItem.createMany({
        data: checklist.map(([title, contentItemId], sortOrder) => ({
          weeklyPlanId: plan.id,
          title,
          contentItemId,
          sortOrder,
        })),
      });
    });
    const created = await this.findWeeklyPlan(
      input.ownerUserId,
      input.weekStart,
    );
    if (!created) throw new Error('Weekly plan was not created');
    return created;
  }

  public approveWeeklyPlan(ownerUserId: bigint, planId: string) {
    return this.db.socialWeeklyPlan.update({
      where: { id: planId, ownerUserId },
      data: { status: SocialWeeklyPlanStatus.APPROVED, approvedAt: new Date() },
    });
  }

  public async toggleChecklist(ownerUserId: bigint, itemId: string) {
    const item = await this.db.socialChecklistItem.findFirst({
      where: { id: itemId, weeklyPlan: { ownerUserId } },
    });
    if (!item) return null;
    return this.db.socialChecklistItem.update({
      where: { id: item.id },
      data: {
        completed: !item.completed,
        completedAt: item.completed ? null : new Date(),
      },
    });
  }

  public async saveContentVersion(input: {
    ownerUserId: bigint;
    contentItemId: string;
    content: string;
    source: keyof typeof SocialVersionSource;
    status?: keyof typeof SocialContentStatus;
    final?: boolean;
  }) {
    return this.db.$transaction(async (transaction) => {
      const item = await transaction.socialContentItem.findFirst({
        where: { id: input.contentItemId, ownerUserId: input.ownerUserId },
      });
      if (!item) throw new Error('Content item not found');
      const latest = await transaction.socialContentVersion.findFirst({
        where: { contentItemId: item.id },
        orderBy: { versionNumber: 'desc' },
      });
      const version = await transaction.socialContentVersion.create({
        data: {
          contentItemId: item.id,
          versionNumber: (latest?.versionNumber ?? 0) + 1,
          content: input.content,
          source: SocialVersionSource[input.source],
        },
      });
      await transaction.socialContentItem.update({
        where: { id: item.id },
        data: {
          ...(input.final
            ? { finalContent: input.content }
            : { draft: input.content }),
          status: input.status
            ? SocialContentStatus[input.status]
            : input.final
              ? SocialContentStatus.READY
              : SocialContentStatus.DRAFT,
        },
      });
      return version;
    });
  }

  public async updateContentStatus(input: {
    ownerUserId: bigint;
    contentItemId: string;
    status: keyof typeof SocialContentStatus;
    scheduledAt?: Date;
    publishedAt?: Date;
    publishedUrl?: string;
  }) {
    if (input.status === 'PUBLISHED' && !input.publishedUrl) {
      throw new Error('Published content requires a confirmed URL');
    }
    return this.db.socialContentItem.update({
      where: { id: input.contentItemId, ownerUserId: input.ownerUserId },
      data: {
        status: SocialContentStatus[input.status],
        ...(input.scheduledAt ? { scheduledAt: input.scheduledAt } : {}),
        ...(input.publishedAt ? { publishedAt: input.publishedAt } : {}),
        ...(input.publishedUrl ? { publishedUrl: input.publishedUrl } : {}),
      },
    });
  }

  public listContent(
    ownerUserId: bigint,
    options?: {
      statuses?: readonly (keyof typeof SocialContentStatus)[];
      limit?: number;
    },
  ) {
    return this.db.socialContentItem.findMany({
      where: {
        ownerUserId,
        ...(options?.statuses?.length
          ? {
              status: {
                in: options.statuses.map(
                  (status) => SocialContentStatus[status],
                ),
              },
            }
          : {}),
      },
      include: {
        idea: true,
        topics: { include: { topic: true } },
        projects: { include: { project: true } },
        metrics: { orderBy: { recordedAt: 'desc' }, take: 1 },
      },
      orderBy: [{ plannedAt: 'desc' }, { createdAt: 'desc' }],
      take: options?.limit ?? 100,
    });
  }

  public contentHistory(ownerUserId: bigint, contentItemId: string) {
    return this.db.socialContentItem.findFirst({
      where: { id: contentItemId, ownerUserId },
      include: {
        idea: true,
        weeklyPlan: true,
        versions: { orderBy: { versionNumber: 'desc' } },
        topics: { include: { topic: true } },
        projects: { include: { project: true } },
        sources: { include: { source: true } },
        metrics: { orderBy: { recordedAt: 'desc' } },
      },
    });
  }

  public async updateDraftContentItem(
    ownerUserId: bigint,
    contentItemId: string,
    input: { title: string; angle: string; hook?: string; cta?: string },
  ) {
    const item = await this.db.socialContentItem.findFirst({
      where: {
        id: contentItemId,
        ownerUserId,
        weeklyPlan: { status: SocialWeeklyPlanStatus.DRAFT },
      },
    });
    if (!item) throw new Error('Draft plan item not found');
    return this.db.socialContentItem.update({
      where: { id: item.id },
      data: {
        title: input.title.trim(),
        angle: input.angle.trim(),
        hook: input.hook?.trim() || null,
        cta: input.cta?.trim() || null,
      },
    });
  }

  public async removeDraftContentItem(
    ownerUserId: bigint,
    contentItemId: string,
  ) {
    return this.db.$transaction(async (transaction) => {
      const item = await transaction.socialContentItem.findFirst({
        where: {
          id: contentItemId,
          ownerUserId,
          weeklyPlan: { status: SocialWeeklyPlanStatus.DRAFT },
        },
      });
      if (!item) throw new Error('Draft plan item not found');
      await transaction.socialContentItem.delete({ where: { id: item.id } });
      const remainingUses = await transaction.socialContentItem.count({
        where: { ideaId: item.ideaId, status: { not: 'ARCHIVED' } },
      });
      if (remainingUses === 0) {
        await transaction.socialContentIdea.update({
          where: { id: item.ideaId },
          data: { status: 'BACKLOG' },
        });
      }
      return item;
    });
  }

  public async updateContentPrompt(
    ownerUserId: bigint,
    contentItemId: string,
    prompt: string,
  ) {
    const result = await this.db.socialContentItem.updateMany({
      where: {
        id: contentItemId,
        ownerUserId,
        weeklyPlan: { status: SocialWeeklyPlanStatus.DRAFT },
      },
      data: { prompt, status: SocialContentStatus.PROMPT_READY },
    });
    if (result.count === 0) throw new Error('Draft plan item not found');
    return this.db.socialContentItem.findUniqueOrThrow({
      where: { id: contentItemId },
    });
  }

  public recordMetrics(input: {
    ownerUserId: bigint;
    contentItemId: string;
    metrics: {
      impressions?: number;
      reach?: number;
      likes?: number;
      comments?: number;
      shares?: number;
      saves?: number;
      clicks?: number;
      websiteVisits?: number;
      leads?: number;
      qualifiedLeads?: number;
      customersAcquired?: number;
      notes?: string;
    };
  }) {
    return this.db.socialContentMetric.create({
      data: {
        ...input.metrics,
        contentItem: {
          connect: { id: input.contentItemId, ownerUserId: input.ownerUserId },
        },
      },
    });
  }

  public async savePack(weeklyPlanId: string, markdown: string) {
    const contentHash = createHash('sha256').update(markdown).digest('hex');
    const existing = await this.db.socialContentPack.findUnique({
      where: { weeklyPlanId_contentHash: { weeklyPlanId, contentHash } },
    });
    if (existing) return existing;
    const latest = await this.db.socialContentPack.findFirst({
      where: { weeklyPlanId },
      orderBy: { version: 'desc' },
    });
    return this.db.socialContentPack.create({
      data: {
        weeklyPlanId,
        version: (latest?.version ?? 0) + 1,
        contentHash,
        markdown,
      },
    });
  }

  public async importBrnoEvents(
    ownerUserId: bigint,
    from: Date,
    to: Date,
  ): Promise<number> {
    const events = await this.db.brnoEvent.findMany({
      where: { cancelled: false, startAt: { gte: from, lte: to } },
      include: { sourceLinks: true },
      orderBy: [{ relevanceScore: 'desc' }, { startAt: 'asc' }],
      take: 100,
    });
    for (const sourceEvent of events) {
      const primary = sourceEvent.sourceLinks[0];
      if (!primary) continue;
      const canonicalUrl = primary.eventUrl;
      const priceStatus = sourceEvent.priceFree
        ? 'FREE'
        : sourceEvent.priceAmount && Number(sourceEvent.priceAmount) > 0
          ? 'PAID'
          : 'UNKNOWN';
      const event = await this.db.socialNetworkingEvent.upsert({
        where: {
          ownerUserId_sourceProvider_sourceExternalId: {
            ownerUserId,
            sourceProvider: 'brno-events',
            sourceExternalId: sourceEvent.id,
          },
        },
        create: {
          ownerUserId,
          title: sourceEvent.title,
          normalizedTitle: sourceEvent.normalizedTitle,
          description: sourceEvent.description,
          organizer: sourceEvent.organizerName,
          venue: sourceEvent.venueName,
          city: 'Brno',
          address: sourceEvent.venueAddress,
          startAt: sourceEvent.startAt,
          endAt: sourceEvent.endAt,
          format: 'IN_PERSON',
          categories: sourceEvent.categories,
          priceAmount: sourceEvent.priceAmount,
          currency: sourceEvent.priceCurrency,
          priceStatus,
          accessType: sourceEvent.registrationRequired
            ? 'REGISTRATION_REQUIRED'
            : 'UNKNOWN',
          registrationUrl: sourceEvent.registrationUrl,
          canonicalUrl,
          sourceProvider: 'brno-events',
          sourceExternalId: sourceEvent.id,
          retrievedAt: sourceEvent.lastSeenAt,
          verifiedAt: sourceEvent.lastSeenAt,
          verificationStatus: 'PARTIALLY_VERIFIED',
          relevanceScore: sourceEvent.relevanceScore,
          relevanceReasons: sourceEvent.relevanceReasons,
        },
        update: {
          title: sourceEvent.title,
          description: sourceEvent.description,
          organizer: sourceEvent.organizerName,
          venue: sourceEvent.venueName,
          address: sourceEvent.venueAddress,
          startAt: sourceEvent.startAt,
          endAt: sourceEvent.endAt,
          categories: sourceEvent.categories,
          priceAmount: sourceEvent.priceAmount,
          currency: sourceEvent.priceCurrency,
          priceStatus,
          registrationUrl: sourceEvent.registrationUrl,
          retrievedAt: sourceEvent.lastSeenAt,
          verifiedAt: sourceEvent.lastSeenAt,
          verificationStatus: 'PARTIALLY_VERIFIED',
          relevanceScore: sourceEvent.relevanceScore,
          relevanceReasons: sourceEvent.relevanceReasons,
          status: sourceEvent.cancelled ? 'CANCELLED' : 'SCHEDULED',
        },
      });
      await Promise.all(
        sourceEvent.sourceLinks.map((link) =>
          this.db.socialNetworkingEventSource.upsert({
            where: {
              eventId_sourceUrl: {
                eventId: event.id,
                sourceUrl: link.eventUrl,
              },
            },
            create: {
              eventId: event.id,
              provider: link.sourceId,
              externalId: link.externalId,
              sourceUrl: link.eventUrl,
              officialUrl: link.eventUrl,
              retrievedAt: link.lastSeenAt,
            },
            update: { retrievedAt: link.lastSeenAt },
          }),
        ),
      );
    }
    return events.length;
  }

  public addManualEvent(input: {
    ownerUserId: bigint;
    title: string;
    startAt: Date;
    endAt?: Date;
    city?: string;
    venue?: string;
    sourceUrl: string;
    registrationUrl?: string;
    priceStatus?: 'FREE' | 'PAID' | 'UNKNOWN';
    priceAmount?: number;
    currency?: string;
    categories?: readonly string[];
  }) {
    return this.db.socialNetworkingEvent.create({
      data: {
        ownerUserId: input.ownerUserId,
        title: input.title.trim(),
        normalizedTitle: normalizeSocialText(input.title),
        startAt: input.startAt,
        endAt: input.endAt ?? null,
        city: input.city ?? null,
        venue: input.venue ?? null,
        canonicalUrl: input.sourceUrl,
        registrationUrl: input.registrationUrl ?? null,
        sourceProvider: 'manual',
        priceStatus: input.priceStatus ?? 'UNKNOWN',
        priceAmount: input.priceAmount ?? null,
        currency: input.currency ?? null,
        categories: [...(input.categories ?? [])],
        verificationStatus: 'UNVERIFIED',
        sourceReferences: {
          create: {
            provider: 'manual',
            sourceUrl: input.sourceUrl,
            officialUrl: input.sourceUrl,
          },
        },
      },
      include: { sourceReferences: true },
    });
  }

  public listNetworkingEvents(input: {
    ownerUserId: bigint;
    from: Date;
    to: Date;
    cities?: readonly string[];
    freeOnly?: boolean;
    limit?: number;
  }) {
    return this.db.socialNetworkingEvent.findMany({
      where: {
        ownerUserId: input.ownerUserId,
        startAt: { gte: input.from, lte: input.to },
        status: 'SCHEDULED',
        ...(input.cities?.length ? { city: { in: [...input.cities] } } : {}),
        ...(input.freeOnly ? { priceStatus: 'FREE' } : {}),
      },
      include: { sourceReferences: true, attendances: true },
      orderBy: [{ relevanceScore: 'desc' }, { startAt: 'asc' }],
      take: input.limit ?? 20,
    });
  }

  public setAttendance(input: {
    ownerUserId: bigint;
    eventId: string;
    status: keyof typeof SocialAttendanceStatus;
    weeklyPlanId?: string;
  }) {
    const status = SocialAttendanceStatus[input.status];
    return this.db.socialEventAttendance.upsert({
      where: {
        ownerUserId_eventId: {
          ownerUserId: input.ownerUserId,
          eventId: input.eventId,
        },
      },
      create: {
        ownerUserId: input.ownerUserId,
        eventId: input.eventId,
        weeklyPlanId: input.weeklyPlanId ?? null,
        status,
        registeredAt: status === 'REGISTERED' ? new Date() : null,
        attendedAt: status === 'ATTENDED' ? new Date() : null,
      },
      update: {
        status,
        ...(input.weeklyPlanId ? { weeklyPlanId: input.weeklyPlanId } : {}),
        ...(status === 'REGISTERED' ? { registeredAt: new Date() } : {}),
        ...(status === 'ATTENDED' ? { attendedAt: new Date() } : {}),
      },
    });
  }

  public listAttendances(ownerUserId: bigint) {
    return this.db.socialEventAttendance.findMany({
      where: { ownerUserId },
      include: {
        event: true,
        contacts: { include: { contact: true } },
        followUps: true,
      },
      orderBy: { event: { startAt: 'desc' } },
      take: 100,
    });
  }

  public async saveAttendanceDebrief(input: {
    ownerUserId: bigint;
    attendanceId: string;
    notes?: string;
    highlights?: string;
    lessons?: string;
  }) {
    return this.db.socialEventAttendance.update({
      where: { id: input.attendanceId, ownerUserId: input.ownerUserId },
      data: {
        status: SocialAttendanceStatus.ATTENDED,
        attendedAt: new Date(),
        notes: input.notes ?? null,
        highlights: input.highlights ?? null,
        lessons: input.lessons ?? null,
      },
    });
  }

  public async addContact(input: {
    ownerUserId: bigint;
    attendanceId: string;
    displayName: string;
    organization?: string;
    role?: string;
    profileUrl?: string;
    conversationNotes?: string;
    followUpIntent?: string;
  }) {
    return this.db.$transaction(async (transaction) => {
      const attendance = await transaction.socialEventAttendance.findFirst({
        where: { id: input.attendanceId, ownerUserId: input.ownerUserId },
      });
      if (!attendance) throw new Error('Attendance not found');
      const contact = await transaction.socialNetworkingContact.upsert({
        where: {
          ownerUserId_normalizedName_organization: {
            ownerUserId: input.ownerUserId,
            normalizedName: normalizeSocialText(input.displayName),
            organization: input.organization ?? '',
          },
        },
        create: {
          ownerUserId: input.ownerUserId,
          displayName: input.displayName.trim(),
          normalizedName: normalizeSocialText(input.displayName),
          organization: input.organization ?? '',
          role: input.role ?? null,
          profileUrl: input.profileUrl ?? null,
          consentOrContext:
            'Osobní kontakt zaznamenaný po potvrzené účasti na akci.',
        },
        update: {
          ...(input.role ? { role: input.role } : {}),
          ...(input.profileUrl ? { profileUrl: input.profileUrl } : {}),
        },
      });
      await transaction.socialAttendanceContact.upsert({
        where: {
          attendanceId_contactId: {
            attendanceId: attendance.id,
            contactId: contact.id,
          },
        },
        create: {
          attendanceId: attendance.id,
          contactId: contact.id,
          conversationNotes: input.conversationNotes ?? null,
          followUpIntent: input.followUpIntent ?? null,
        },
        update: {
          ...(input.conversationNotes
            ? { conversationNotes: input.conversationNotes }
            : {}),
          ...(input.followUpIntent
            ? { followUpIntent: input.followUpIntent }
            : {}),
        },
      });
      return contact;
    });
  }

  public listContacts(ownerUserId: bigint) {
    return this.db.socialNetworkingContact.findMany({
      where: { ownerUserId },
      include: {
        followUps: {
          where: { status: SocialFollowUpStatus.OPEN },
          orderBy: { dueAt: 'asc' },
        },
        attendances: { include: { attendance: { include: { event: true } } } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
  }

  public createFollowUp(input: {
    ownerUserId: bigint;
    contactId: string;
    attendanceId?: string;
    title: string;
    dueAt: Date;
    notes?: string;
  }) {
    return this.db.socialNetworkingFollowUp.create({
      data: input,
    });
  }

  public getFollowUp(ownerUserId: bigint, id: string) {
    return this.db.socialNetworkingFollowUp.findFirst({
      where: { id, ownerUserId },
      include: { contact: true, attendance: { include: { event: true } } },
    });
  }

  public deleteContact(ownerUserId: bigint, id: string) {
    return this.db.socialNetworkingContact.delete({
      where: { id, ownerUserId },
    });
  }

  public linkEventIdea(input: {
    ownerUserId: bigint;
    attendanceId: string;
    contentIdeaId: string;
    provenanceNotes: string;
  }) {
    return this.db.socialEventContentIdea.create({
      data: {
        eventAttendance: {
          connect: { id: input.attendanceId, ownerUserId: input.ownerUserId },
        },
        contentIdea: {
          connect: { id: input.contentIdeaId, ownerUserId: input.ownerUserId },
        },
        provenanceNotes: input.provenanceNotes,
      },
    });
  }

  public completeFollowUp(ownerUserId: bigint, id: string) {
    return this.db.socialNetworkingFollowUp.update({
      where: { id, ownerUserId },
      data: { status: SocialFollowUpStatus.COMPLETED, completedAt: new Date() },
    });
  }

  public upsertScheduledJob(input: {
    ownerUserId: bigint;
    chatId: bigint;
    kind: string;
    scheduledFor: Date;
    payload?: unknown;
  }) {
    return this.db.socialScheduledJob.upsert({
      where: {
        ownerUserId_kind_scheduledFor: {
          ownerUserId: input.ownerUserId,
          kind: input.kind,
          scheduledFor: input.scheduledFor,
        },
      },
      create: {
        ...input,
        payload: json(input.payload ?? {}),
      },
      update: {},
    });
  }

  public async claimDueJobs(
    now: Date,
    kinds?: readonly string[],
    kindPrefixes?: readonly string[],
  ) {
    const candidates = await this.db.socialScheduledJob.findMany({
      where: {
        status: SocialSchedulerStatus.PENDING,
        scheduledFor: { lte: now },
        ...(kinds?.length || kindPrefixes?.length
          ? {
              OR: [
                ...(kinds?.length ? [{ kind: { in: [...kinds] } }] : []),
                ...(kindPrefixes ?? []).map((prefix) => ({
                  kind: { startsWith: prefix },
                })),
              ],
            }
          : {}),
      },
      orderBy: { scheduledFor: 'asc' },
      take: 20,
    });
    const claimed = [];
    for (const candidate of candidates) {
      const result = await this.db.socialScheduledJob.updateMany({
        where: { id: candidate.id, status: SocialSchedulerStatus.PENDING },
        data: { status: SocialSchedulerStatus.CLAIMED, claimedAt: now },
      });
      if (result.count === 1) claimed.push(candidate);
    }
    return claimed;
  }

  public completeScheduledJob(id: string) {
    return this.db.socialScheduledJob.update({
      where: { id },
      data: {
        status: SocialSchedulerStatus.COMPLETED,
        completedAt: new Date(),
      },
    });
  }

  public failScheduledJob(id: string, error: string) {
    return this.db.socialScheduledJob.update({
      where: { id },
      data: { status: SocialSchedulerStatus.FAILED, lastError: error },
    });
  }

  public listSettings() {
    return this.db.socialSettings.findMany();
  }

  public listPendingNotionItems(ownerUserId: bigint) {
    return this.db.socialContentItem.findMany({
      where: {
        ownerUserId,
        status: { not: SocialContentStatus.ARCHIVED },
      },
      include: {
        idea: true,
        topics: { include: { topic: true } },
        projects: { include: { project: true } },
        sources: { include: { source: true } },
      },
      orderBy: { updatedAt: 'asc' },
    });
  }

  public getExternalSync(input: {
    ownerUserId: bigint;
    localEntityType: string;
    localEntityId: string;
    provider: string;
  }) {
    return this.db.socialExternalSync.findUnique({
      where: {
        ownerUserId_localEntityType_localEntityId_provider: input,
      },
    });
  }

  public saveExternalSync(input: {
    ownerUserId: bigint;
    localEntityType: string;
    localEntityId: string;
    provider: string;
    externalId: string;
    lastLocalHash?: string;
    lastRemoteEditedAt?: Date;
    status: 'PENDING' | 'SYNCED' | 'CONFLICT' | 'FAILED';
    lastError?: string;
  }) {
    const key = {
      ownerUserId: input.ownerUserId,
      localEntityType: input.localEntityType,
      localEntityId: input.localEntityId,
      provider: input.provider,
    };
    return this.db.socialExternalSync.upsert({
      where: { ownerUserId_localEntityType_localEntityId_provider: key },
      create: {
        ...key,
        externalId: input.externalId,
        lastLocalHash: input.lastLocalHash ?? null,
        lastRemoteEditedAt: input.lastRemoteEditedAt ?? null,
        syncStatus: input.status,
        lastError: input.lastError ?? null,
        lastSyncedAt: input.status === 'SYNCED' ? new Date() : null,
      },
      update: {
        externalId: input.externalId,
        lastLocalHash: input.lastLocalHash ?? null,
        lastRemoteEditedAt: input.lastRemoteEditedAt ?? null,
        syncStatus: input.status,
        lastError: input.lastError ?? null,
        ...(input.status === 'SYNCED' ? { lastSyncedAt: new Date() } : {}),
      },
    });
  }
}
