import type { Prisma } from './generated/prisma/client.js';
import type { DatabaseClient } from './client.js';

export type SalesLeadInput = {
  campaignId: string;
  source: string;
  sourceExternalId: string;
  companyName: string;
  websiteUrl?: string;
  sourceUrl?: string;
};

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
            ...(domain ? [{ domain }] : []),
          ],
        },
      });
      return (
        existing ??
        tx.salesLead.create({
          data: { ...input, ...(domain ? { domain } : {}) },
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
      email?: string;
      phone?: string;
      phoneSourceUrl?: string;
      emailSyntaxValid: boolean;
      contactSourceUrl?: string;
      audit: unknown;
      analysis: unknown;
      baseScore: number;
      llmAdjustment: number;
      finalScore: number;
      draftSubject: string;
      draftBody: string;
      minimumLeadScore: number;
    },
  ) {
    const { minimumLeadScore, ...rest } = input;
    return this.db.salesLead.update({
      where: { id },
      data: {
        ...rest,
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
}
