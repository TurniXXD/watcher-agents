import type { WatcherLogger } from '@watcher/core';
import type { SalesStore } from '@watcher/database';
import { z } from 'zod';
import { sendEligibility } from './eligibility.js';
import {
  auditWebsite,
  discoverFromFeed,
  draftOutreach,
  scoreAudit,
  type QuicklyClient,
  type TwentyClient,
} from './providers.js';

const emailSchema = z.email();

export class SalesService {
  private running = false;
  public constructor(
    private readonly store: SalesStore,
    private readonly logger: WatcherLogger,
    private readonly quickly?: QuicklyClient,
    private readonly twenty?: TwentyClient,
  ) {}

  public async eligibility(leadId: string): Promise<
    | {
        eligible: boolean;
        reasons: string[];
        lead: NonNullable<Awaited<ReturnType<SalesStore['getLead']>>>;
      }
    | undefined
  > {
    const lead = await this.store.getLead(leadId);
    if (!lead) return undefined;
    const email = lead.email?.toLowerCase() ?? null;
    const [authorization, suppressions] = await Promise.all([
      email
        ? this.store.getAuthorization(lead.campaignId, email)
        : Promise.resolve(null),
      email
        ? this.store.getSuppressions(email, lead.domain ?? undefined)
        : Promise.resolve([]),
    ]);
    const result = sendEligibility({
      ...lead,
      authorization,
      suppressed: suppressions.length > 0,
    });
    if (!this.quickly) result.reasons.push('quickly_not_configured');
    return { ...result, eligible: result.reasons.length === 0, lead };
  }

  public async run(): Promise<{
    discovered: number;
    analyzed: number;
    synced: number;
    failures: number;
  }> {
    if (this.running) throw new Error('Sales pipeline is already running');
    this.running = true;
    const result = { discovered: 0, analyzed: 0, synced: 0, failures: 0 };
    try {
      const campaigns = await this.store.listCampaigns();
      const discovery = await Promise.allSettled(
        campaigns
          .filter((campaign) => campaign.discoveryFeedUrl)
          .map(async (campaign) => {
            const companies = await discoverFromFeed(
              campaign.discoveryFeedUrl!,
            );
            for (const company of companies) {
              await this.store.discoverLead({
                campaignId: campaign.id,
                source: 'JSON_FEED',
                sourceExternalId: company.id,
                companyName: company.name,
                websiteUrl: company.websiteUrl,
                ...(company.sourceUrl ? { sourceUrl: company.sourceUrl } : {}),
              });
            }
            return companies.length;
          }),
      );
      for (const settled of discovery) {
        if (settled.status === 'fulfilled') result.discovered += settled.value;
        else {
          result.failures += 1;
          this.logger.warn(
            { err: settled.reason },
            'Sales discovery source failed',
          );
        }
      }
      for (const lead of await this.store.listUnprocessed()) {
        try {
          if (!lead.websiteUrl) throw new Error('Lead has no website URL');
          const audit = await auditWebsite(lead.websiteUrl);
          const email = audit.foundEmail;
          const score = scoreAudit(audit);
          const draft = draftOutreach(
            lead.companyName,
            lead.campaign.offer,
            audit,
            lead.campaign.subjectTemplate,
            lead.campaign.bodyTemplate,
          );
          await this.store.markAnalyzed(lead.id, {
            domain: new URL(audit.sourceUrl).hostname.replace(/^www\./u, ''),
            ...(email ? { email, contactSourceUrl: audit.emailSourceUrl } : {}),
            ...(audit.foundPhone
              ? {
                  phone: audit.foundPhone,
                  phoneSourceUrl: audit.phoneSourceUrl,
                }
              : {}),
            emailSyntaxValid: email
              ? emailSchema.safeParse(email).success
              : false,
            audit,
            analysis: {
              observations: [
                audit.hasMobileViewport
                  ? 'Mobile viewport observed'
                  : 'Mobile viewport not found',
                audit.hasDescription
                  ? 'Description observed'
                  : 'Description not found',
              ],
              sourceUrl: audit.sourceUrl,
              method: 'deterministic-mvp',
            },
            baseScore: score,
            llmAdjustment: 0,
            finalScore: score,
            draftSubject: draft.subject,
            draftBody: draft.body,
            minimumLeadScore: lead.campaign.minimumLeadScore,
          });
          result.analyzed += 1;
          if (this.twenty && !lead.twentyCompanyId) {
            try {
              const id = await this.twenty.createCompany(
                lead.companyName,
                audit.sourceUrl,
              );
              await this.store.setTwentyCompanyId(lead.id, id);
            } catch (error) {
              this.logger.warn(
                { err: error, leadId: lead.id },
                'Twenty sync failed; lead analysis remains available',
              );
            }
          }
        } catch (error) {
          result.failures += 1;
          await this.store.markProcessingFailure(
            lead.id,
            error instanceof Error ? error.message : String(error),
            lead.attemptCount,
          );
          this.logger.warn(
            { err: error, leadId: lead.id },
            'Sales lead processing failed',
          );
        }
      }
      await this.store.recoverStaleSyncClaims(
        new Date(Date.now() - 15 * 60_000),
      );
      for (const lead of await this.store.listApprovedPending()) {
        const check = await this.eligibility(lead.id);
        if (
          !check?.eligible ||
          !lead.email ||
          !lead.campaign.quicklyCampaignId ||
          !lead.draftSubject ||
          !lead.draftBody ||
          !this.quickly
        )
          continue;
        const midnight = new Date();
        midnight.setUTCHours(0, 0, 0, 0);
        if (
          (await this.store.countSyncedToday(lead.campaignId, midnight)) >=
          lead.campaign.dailyOutreachLimit
        )
          continue;
        const claim = await this.store.claimForSync(lead.id);
        if (claim.count !== 1) continue;
        try {
          const fresh = await this.eligibility(lead.id);
          // SYNCING is a temporary lock. Re-evaluate all other gates after claiming.
          if (
            !fresh ||
            sendEligibility({
              ...fresh.lead,
              stage: 'QUALIFIED',
              authorization: fresh.lead.email
                ? await this.store.getAuthorization(
                    fresh.lead.campaignId,
                    fresh.lead.email,
                  )
                : null,
              suppressed: fresh.reasons.includes('suppressed'),
            }).eligible === false
          ) {
            await this.store.releaseSyncClaim(lead.id);
            continue;
          }
          const id = await this.quickly.enroll(
            lead.campaign.quicklyCampaignId,
            {
              email: lead.email,
              companyName: lead.companyName,
              subject: lead.draftSubject,
              body: lead.draftBody,
            },
          );
          await this.store.markSynced(lead.id, id);
          result.synced += 1;
        } catch (error) {
          result.failures += 1;
          await this.store.markSyncFailure(
            lead.id,
            error instanceof Error ? error.message : String(error),
            lead.attemptCount,
          );
          this.logger.error(
            { err: error, leadId: lead.id },
            'Quickly enrollment failed',
          );
        }
      }
      return result;
    } finally {
      this.running = false;
    }
  }
}
