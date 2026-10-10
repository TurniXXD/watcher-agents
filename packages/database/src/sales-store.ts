import type { Prisma } from './generated/prisma/client.js';
import type { DatabaseClient } from './client.js';

export type SalesLeadInput = {
  campaignId: string;
  source: string;
  sourceExternalId: string;
  companyName: string;
  entityType?: 'COMPANY' | 'PERSON';
  websiteUrl?: string;
  sourceUrl?: string;
  location?: string;
  registrationId?: string;
  sourceData?: unknown;
};

const normalizeSearchPart = (value: string): string =>
  value.trim().toLocaleLowerCase('cs-CZ').replace(/\s+/gu, ' ');

const normalizeSearchError = (value: string): string =>
  value.replaceAll(/\s+/gu, ' ').trim().slice(0, 2_000);

export class SalesStore {
  public constructor(private readonly db: DatabaseClient) {}

  public listCampaigns() {
    return this.db.salesCampaign.findMany({ orderBy: { createdAt: 'asc' } });
  }

  public getCampaign(id: string) {
    return this.db.salesCampaign.findUnique({ where: { id } });
  }

  public createCampaign(input: {
    name: string;
    offer: string;
    subjectTemplate: string;
    bodyTemplate: string;
    discoveryFeedUrl?: string;
    quicklyCampaignId?: number;
  }) {
    return this.db.salesCampaign.create({ data: input });
  }

  public updateCampaign(
    id: string,
    data: {
      enabled?: boolean;
      pausedReason?: string | null;
      quicklyCampaignId?: number | null;
      discoveryFeedUrl?: string | null;
    },
  ) {
    return this.db.salesCampaign.update({ where: { id }, data });
  }

  public upsertSearchSubscription(input: {
    telegramChatId: bigint;
    telegramUserId: bigint;
    query: string;
    locality: string;
    resultLimit: number;
    intervalMinutes: number;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const normalizedQuery = normalizeSearchPart(input.query);
    const normalizedLocality = normalizeSearchPart(input.locality);
    const nextRunAt = new Date(now.getTime() + input.intervalMinutes * 60_000);
    return this.db.salesSearchSubscription.upsert({
      where: {
        telegramChatId_normalizedQuery_normalizedLocality: {
          telegramChatId: input.telegramChatId,
          normalizedQuery,
          normalizedLocality,
        },
      },
      create: {
        telegramChatId: input.telegramChatId,
        telegramUserId: input.telegramUserId,
        query: input.query,
        normalizedQuery,
        locality: input.locality,
        normalizedLocality,
        resultLimit: input.resultLimit,
        intervalMinutes: input.intervalMinutes,
        nextRunAt,
      },
      update: {
        telegramUserId: input.telegramUserId,
        query: input.query,
        locality: input.locality,
        resultLimit: input.resultLimit,
        intervalMinutes: input.intervalMinutes,
        enabled: true,
        nextRunAt,
        lastError: null,
      },
    });
  }

  public listSearchSubscriptions(telegramChatId: bigint) {
    return this.db.salesSearchSubscription.findMany({
      where: { telegramChatId, enabled: true },
      orderBy: [{ createdAt: 'asc' }],
    });
  }

  public getSearchSubscription(id: string) {
    return this.db.salesSearchSubscription.findUnique({ where: { id } });
  }

  public async disableSearchSubscriptions(
    telegramChatId: bigint,
    id?: string,
  ): Promise<number> {
    const result = await this.db.salesSearchSubscription.updateMany({
      where: {
        telegramChatId,
        enabled: true,
        ...(id ? { id } : {}),
      },
      data: { enabled: false },
    });
    return result.count;
  }

  public async claimDueSearchSubscriptions(now = new Date(), take = 10) {
    const candidates = await this.db.salesSearchSubscription.findMany({
      where: { enabled: true, nextRunAt: { lte: now } },
      orderBy: [{ nextRunAt: 'asc' }, { createdAt: 'asc' }],
      take,
    });
    const claimed = await Promise.all(
      candidates.map(async (candidate) => {
        const nextRunAt = new Date(
          now.getTime() + candidate.intervalMinutes * 60_000,
        );
        const result = await this.db.salesSearchSubscription.updateMany({
          where: {
            id: candidate.id,
            enabled: true,
            nextRunAt: { lte: now },
          },
          data: { nextRunAt },
        });
        return result.count === 1 ? { id: candidate.id } : undefined;
      }),
    );
    return claimed.filter(
      (entry): entry is { id: string } => entry !== undefined,
    );
  }

  public async unseenSearchResultKeys(
    subscriptionId: string,
    resultKeys: readonly string[],
  ): Promise<Set<string>> {
    if (resultKeys.length === 0) return new Set();
    const existing = await this.db.salesSearchSeenResult.findMany({
      where: { subscriptionId, resultKey: { in: [...resultKeys] } },
      select: { resultKey: true },
    });
    const existingKeys = new Set(existing.map(({ resultKey }) => resultKey));
    return new Set(resultKeys.filter((key) => !existingKeys.has(key)));
  }

  public async completeSearchSubscription(
    subscriptionId: string,
    resultKeys: readonly string[],
    now = new Date(),
  ): Promise<void> {
    await this.db.$transaction([
      ...(resultKeys.length
        ? [
            this.db.salesSearchSeenResult.createMany({
              data: resultKeys.map((resultKey) => ({
                subscriptionId,
                resultKey,
                firstSeenAt: now,
              })),
              skipDuplicates: true,
            }),
          ]
        : []),
      this.db.salesSearchSubscription.update({
        where: { id: subscriptionId },
        data: { lastRunAt: now, lastError: null },
      }),
    ]);
  }

  public async failSearchSubscription(
    subscriptionId: string,
    error: string,
    now = new Date(),
  ): Promise<void> {
    await this.db.salesSearchSubscription.update({
      where: { id: subscriptionId },
      data: {
        lastRunAt: now,
        lastError: normalizeSearchError(error),
      },
    });
  }

  public discoverLead(input: SalesLeadInput) {
    const domain = input.websiteUrl
      ? new URL(input.websiteUrl).hostname.replace(/^www\./u, '').toLowerCase()
      : undefined;
    return this.db.$transaction(async (tx) => {
      const existing = await tx.salesLead.findFirst({
        where: {
          campaignId: input.campaignId,
          OR: [
            { source: input.source, sourceExternalId: input.sourceExternalId },
            ...(input.registrationId
              ? [{ registrationId: input.registrationId }]
              : []),
            ...(domain ? [{ domain }] : []),
          ],
        },
      });
      const { sourceData, ...leadData } = input;
      return (
        existing ??
        tx.salesLead.create({
          data: {
            ...leadData,
            ...(sourceData
              ? {
                  sourceData: JSON.parse(
                    JSON.stringify(sourceData),
                  ) as Prisma.InputJsonValue,
                }
              : {}),
            ...(domain ? { domain } : {}),
          },
        })
      );
    });
  }

  public getLead(id: string) {
    return this.db.salesLead.findUnique({
      where: { id },
      include: { campaign: true },
    });
  }

  public listLeads(campaignId?: string, take = 20) {
    return this.db.salesLead.findMany({
      where: campaignId ? { campaignId } : {},
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  public listCallCandidates(take = 20) {
    return this.db.salesLead.findMany({
      where: {
        phone: { not: null },
        phoneSourceUrl: { not: null },
        rejectedAt: null,
        stage: {
          in: [
            'ANALYZED',
            'QUALIFIED',
            'SYNCED_TO_QUICKLY',
            'CONTACTED',
            'REPLIED',
            'INTERESTED',
          ],
        },
      },
      include: { campaign: true },
      orderBy: [{ finalScore: 'desc' }, { createdAt: 'desc' }],
      take,
    });
  }

  public listUnprocessed(limit = 20) {
    return this.db.salesLead.findMany({
      where: { stage: 'DISCOVERED', nextAttemptAt: { lte: new Date() } },
      include: { campaign: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  public async markAnalyzed(
    id: string,
    input: {
      domain?: string;
      registrationId?: string;
      email?: string;
      phone?: string;
      phoneSourceUrl?: string;
      emailSyntaxValid: boolean;
      contactSourceUrl?: string;
      audit: unknown;
      analysis: unknown;
      country?: {
        code: string;
        confidence: number;
        source: string;
      };
      language?: {
        primary: string;
        detected: string[];
        confidence: number;
        source: string;
      };
      outreachLanguage?: {
        language: string;
        reason: string;
        confidence: number;
      };
      baseScore: number;
      llmAdjustment: number;
      finalScore: number;
      draftSubject: string;
      draftBody: string;
      draftMetadata?: {
        promptVersion: string;
        model: string;
        personalizationFact?: string;
        generationConfidence: number;
        insufficientPersonalizationData: boolean;
        createdAt: Date;
      };
      minimumLeadScore: number;
    },
  ) {
    const {
      minimumLeadScore,
      country,
      language,
      outreachLanguage,
      draftMetadata,
      ...rest
    } = input;
    return this.db.salesLead.update({
      where: { id },
      data: {
        ...rest,
        ...(country
          ? {
              countryCode: country.code,
              countryConfidence: country.confidence,
              countryDetectionSource: country.source,
            }
          : {}),
        ...(language
          ? {
              primaryLanguage: language.primary,
              detectedLanguages: language.detected,
              languageConfidence: language.confidence,
              languageDetectionSource: language.source,
            }
          : {}),
        ...(outreachLanguage
          ? {
              outreachLanguage: outreachLanguage.language,
              outreachLanguageReason: outreachLanguage.reason,
              outreachLanguageConfidence: outreachLanguage.confidence,
            }
          : {}),
        ...(draftMetadata
          ? {
              draftPromptVersion: draftMetadata.promptVersion,
              draftModel: draftMetadata.model,
              draftPersonalizationFact:
                draftMetadata.personalizationFact ?? null,
              draftGenerationConfidence: draftMetadata.generationConfidence,
              draftInsufficientPersonalizationData:
                draftMetadata.insufficientPersonalizationData,
              draftCreatedAt: draftMetadata.createdAt,
            }
          : {}),
        audit: JSON.parse(JSON.stringify(input.audit)) as Prisma.InputJsonValue,
        analysis: JSON.parse(
          JSON.stringify(input.analysis),
        ) as Prisma.InputJsonValue,
        stage: input.finalScore >= minimumLeadScore ? 'QUALIFIED' : 'ANALYZED',
        lastError: null,
      },
    });
  }

  public markProcessingFailure(id: string, error: string, attempts: number) {
    return this.db.salesLead.update({
      where: { id },
      data: {
        attemptCount: { increment: 1 },
        lastError: error.slice(0, 500),
        nextAttemptAt: new Date(
          Date.now() + Math.min(3600, 2 ** attempts * 60) * 1000,
        ),
      },
    });
  }

  public async decideLead(
    id: string,
    approved: boolean,
    source: 'TELEGRAM' | 'API',
    actor: string,
  ) {
    return this.db.$transaction(async (tx) => {
      const lead = await tx.salesLead.findUnique({ where: { id } });
      if (!lead || !['QUALIFIED', 'ANALYZED'].includes(lead.stage))
        throw new Error('Lead is not available for a decision');
      await tx.salesLeadDecision.create({
        data: { leadId: id, approved, source, actor },
      });
      return tx.salesLead.update({
        where: { id },
        data: approved
          ? {
              approvedAt: new Date(),
              approvedBy: actor,
              approvedVia: source,
              rejectedAt: null,
            }
          : {
              approvedAt: null,
              approvedBy: null,
              approvedVia: null,
              rejectedAt: new Date(),
              stage: 'REJECTED',
            },
      });
    });
  }

  public async recordAuthorization(input: {
    campaignId: string;
    email: string;
    basis: 'RECIPIENT_OPT_IN' | 'EXISTING_CUSTOMER';
    evidenceSource: string;
    evidenceReference: string;
    capturedAt: Date;
    expiresAt?: Date;
  }) {
    return this.db.$transaction(async (tx) => {
      const where = {
        campaignId_email: { campaignId: input.campaignId, email: input.email },
      };
      const previous = await tx.salesContactAuthorization.findUnique({ where });
      if (previous) {
        if (previous.revokedAt && input.capturedAt <= previous.revokedAt)
          throw new Error(
            'Renewal requires evidence captured after revocation',
          );
        if (input.capturedAt <= previous.capturedAt) {
          if (
            previous.evidenceReference === input.evidenceReference &&
            !previous.revokedAt
          )
            return previous;
          throw new Error('New evidence must have a later capture time');
        }
      }
      const current = await tx.salesContactAuthorization.upsert({
        where,
        create: input,
        update: {
          ...input,
          expiresAt: input.expiresAt ?? null,
          revokedAt: null,
        },
      });
      await tx.salesAuthorizationEvent.create({
        data: {
          campaignId: input.campaignId,
          email: input.email,
          action: 'RECORDED',
          basis: input.basis,
          evidenceSource: input.evidenceSource,
          evidenceReference: input.evidenceReference,
          capturedAt: input.capturedAt,
          expiresAt: input.expiresAt ?? null,
        },
      });
      return current;
    });
  }

  public revokeAuthorization(campaignId: string, email: string) {
    return this.db.$transaction(async (tx) => {
      const where = { campaignId_email: { campaignId, email } };
      const previous = await tx.salesContactAuthorization.findUnique({ where });
      if (!previous) throw new Error('Authorization not found');
      if (previous.revokedAt) return previous;
      const current = await tx.salesContactAuthorization.update({
        where,
        data: { revokedAt: new Date() },
      });
      await tx.salesAuthorizationEvent.create({
        data: { campaignId, email, action: 'REVOKED' },
      });
      return current;
    });
  }

  public listAuthorizationEvents(campaignId: string, email: string) {
    return this.db.salesAuthorizationEvent.findMany({
      where: { campaignId, email },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
  }

  public getAuthorization(campaignId: string, email: string) {
    return this.db.salesContactAuthorization.findUnique({
      where: { campaignId_email: { campaignId, email } },
    });
  }

  public suppress(key: string, reason: string) {
    return this.db.salesSuppression.upsert({
      where: { key },
      create: { key, reason },
      update: { reason },
    });
  }

  public getSuppressions(email: string, domain?: string) {
    return this.db.salesSuppression.findMany({
      where: {
        key: {
          in: domain
            ? [`email:${email}`, `domain:${domain}`]
            : [`email:${email}`],
        },
      },
    });
  }

  public listApprovedPending(limit = 20) {
    return this.db.salesLead.findMany({
      where: {
        stage: 'QUALIFIED',
        approvedAt: { not: null },
        nextAttemptAt: { lte: new Date() },
      },
      include: { campaign: true },
      orderBy: { approvedAt: 'asc' },
      take: limit,
    });
  }

  public recoverStaleSyncClaims(olderThan: Date) {
    return this.db.salesLead.updateMany({
      where: { stage: 'SYNCING', updatedAt: { lt: olderThan } },
      data: {
        stage: 'QUALIFIED',
        lastError:
          'Recovered stale Quickly enrollment claim; retry uses duplicate protection',
      },
    });
  }

  public countSyncedToday(campaignId: string, since: Date) {
    return this.db.salesLead.count({
      where: { campaignId, quicklyEnrolledAt: { gte: since } },
    });
  }

  public claimForSync(id: string) {
    return this.db.salesLead.updateMany({
      where: { id, stage: 'QUALIFIED', approvedAt: { not: null } },
      data: { stage: 'SYNCING' },
    });
  }

  public async markSynced(id: string, quicklyLeadId?: number): Promise<void> {
    const data = {
      ...(quicklyLeadId !== undefined ? { quicklyLeadId } : {}),
      quicklyEnrolledAt: new Date(),
      lastError: null,
    };
    const claimed = await this.db.salesLead.updateMany({
      where: { id, stage: 'SYNCING' },
      data: { ...data, stage: 'SYNCED_TO_QUICKLY' },
    });
    if (claimed.count === 0)
      await this.db.salesLead.update({ where: { id }, data });
  }

  public releaseSyncClaim(id: string) {
    return this.db.salesLead.update({
      where: { id },
      data: { stage: 'QUALIFIED' },
    });
  }

  public markSyncFailure(id: string, error: string, attempts: number) {
    return this.db.salesLead.update({
      where: { id },
      data: {
        stage: 'QUALIFIED',
        attemptCount: { increment: 1 },
        lastError: error.slice(0, 500),
        nextAttemptAt: new Date(
          Date.now() + Math.min(3600, 2 ** attempts * 60) * 1000,
        ),
      },
    });
  }

  public recordWebhook(
    id: string,
    event: string,
    payload: unknown,
    occurredAt: Date,
    leadId?: string,
  ) {
    return this.db.salesWebhookEvent.create({
      data: {
        id,
        event,
        payload: JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue,
        occurredAt,
        ...(leadId ? { leadId } : {}),
      },
    });
  }

  public listSentEmailEvents(from: Date, to: Date) {
    return this.db.salesWebhookEvent.findMany({
      where: {
        event: 'email.sent',
        occurredAt: { gte: from, lt: to },
        leadId: { not: null },
      },
      include: { lead: { include: { campaign: true } } },
      orderBy: { occurredAt: 'asc' },
    });
  }

  public findLeadByQuicklyCampaignEmail(
    quicklyCampaignId: number,
    email: string,
  ) {
    return this.db.salesLead.findFirst({
      where: {
        email,
        campaign: { quicklyCampaignId },
      },
    });
  }

  public hasWebhook(id: string) {
    return this.db.salesWebhookEvent.findUnique({
      where: { id },
      select: { id: true },
    });
  }

  public findLeadByQuicklyId(quicklyLeadId: number) {
    return this.db.salesLead.findFirst({ where: { quicklyLeadId } });
  }

  public findLeadByEmail(email: string) {
    return this.db.salesLead.findFirst({
      where: { email },
      orderBy: { createdAt: 'desc' },
    });
  }

  public setLeadStage(
    id: string,
    stage:
      | 'CONTACTED'
      | 'REPLIED'
      | 'INTERESTED'
      | 'NOT_INTERESTED'
      | 'BOUNCED'
      | 'UNSUBSCRIBED',
  ) {
    if (stage === 'CONTACTED') {
      return this.db.salesLead.updateMany({
        where: {
          id,
          stage: {
            in: ['QUALIFIED', 'SYNCING', 'SYNCED_TO_QUICKLY', 'CONTACTED'],
          },
        },
        data: { stage },
      });
    }
    return this.db.salesLead.update({ where: { id }, data: { stage } });
  }

  public setTwentyCompanyId(id: string, twentyCompanyId: string) {
    return this.db.salesLead.update({
      where: { id },
      data: { twentyCompanyId },
    });
  }

  public setTwentySyncIds(
    id: string,
    input: {
      companyId?: string;
      personId?: string;
      opportunityId?: string;
      draftNoteId?: string;
    },
  ) {
    return this.db.salesLead.update({
      where: { id },
      data: {
        ...(input.companyId ? { twentyCompanyId: input.companyId } : {}),
        ...(input.personId ? { twentyPersonId: input.personId } : {}),
        ...(input.opportunityId
          ? { twentyOpportunityId: input.opportunityId }
          : {}),
        ...(input.draftNoteId ? { twentyDraftNoteId: input.draftNoteId } : {}),
      },
    });
  }
}
