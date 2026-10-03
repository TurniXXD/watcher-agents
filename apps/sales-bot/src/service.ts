import type { WatcherLogger } from '@watcher/core';
import type { SalesStore } from '@watcher/database';
import { findExactAresCompany } from '@watcher/sources/company';
import { z } from 'zod';
import type { ColdEmailGenerator } from './cold-email-generator.js';
import {
  detectCountry,
  detectLanguage,
  normalizeEntityType,
  selectOutreachLanguage,
} from './classification/index.js';
import type { GooglePlacesDiscoveryClient } from './discovery.js';
import { sendEligibility } from './eligibility.js';
import {
  auditWebsite,
  discoverFromFeed,
  draftOutreach,
  scoreAuditDetailed,
  type QuicklyClient,
} from './providers.js';
import type { TwentyIntegration } from './integrations/twenty/index.js';
import {
  buildColdEmailContext,
  verifiedResearchFacts,
} from './lead-context.js';
import { COLD_EMAIL_PROMPT_VERSION } from './prompts/cold-email/index.js';

const emailSchema = z.email();
const discoveryMetadataSchema = z
  .object({
    countryCode: z.string().length(2).optional(),
    languageCode: z.string().min(2).max(12).optional(),
    phone: z.string().min(7).max(40).optional(),
  })
  .passthrough();

export class SalesService {
  private running = false;
  public constructor(
    private readonly store: SalesStore,
    private readonly logger: WatcherLogger,
    private readonly quickly?: QuicklyClient,
    private readonly twenty?: TwentyIntegration,
    private readonly places?: GooglePlacesDiscoveryClient,
    private readonly coldEmailGenerator?: ColdEmailGenerator,
    private readonly coldEmailModel?: string,
  ) {}

  public get discoveryConfigured(): boolean {
    return Boolean(this.places);
  }

  public async discoverBusinesses(input: {
    campaignId: string;
    query: string;
    locality: string;
    limit: number;
  }): Promise<{ found: number; imported: number }> {
    const campaign = await this.store.getCampaign(input.campaignId);
    if (!campaign) throw new Error('Campaign not found');
    if (!this.places)
      throw new Error('Google Places discovery is not configured');
    const companies = await this.places.search(
      input.query,
      input.locality,
      input.limit,
    );
    for (const company of companies) {
      await this.store.discoverLead({
        campaignId: campaign.id,
        source: 'GOOGLE_PLACES',
        sourceExternalId: company.id,
        companyName: company.name,
        entityType: 'COMPANY',
        websiteUrl: company.websiteUrl,
        sourceUrl: company.sourceUrl,
        ...(company.address ? { location: company.address } : {}),
        sourceData: {
          ...(company.address ? { address: company.address } : {}),
          ...(company.phone ? { phone: company.phone } : {}),
        },
      });
    }
    this.logger.info(
      {
        campaignId: campaign.id,
        query: input.query,
        locality: input.locality,
        candidates: companies.length,
      },
      'Sales business discovery completed',
    );
    return { found: companies.length, imported: companies.length };
  }

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
      this.logger.info(
        {
          campaigns: campaigns.length,
          discoveryFeeds: campaigns.filter(
            (campaign) => campaign.discoveryFeedUrl,
          ).length,
          placesConfigured: this.discoveryConfigured,
          quicklyConfigured: Boolean(this.quickly),
          twentyConfigured: Boolean(this.twenty),
        },
        'Sales pipeline run started',
      );
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
                entityType: normalizeEntityType(company.entityType),
                websiteUrl: company.websiteUrl,
                ...(company.sourceUrl ? { sourceUrl: company.sourceUrl } : {}),
                ...(company.address ? { location: company.address } : {}),
                sourceData: {
                  ...(company.entityType
                    ? { entityType: company.entityType }
                    : {}),
                  ...(company.address ? { address: company.address } : {}),
                  ...(company.countryCode
                    ? { countryCode: company.countryCode }
                    : {}),
                  ...(company.languageCode
                    ? { languageCode: company.languageCode }
                    : {}),
                  ...(company.phone ? { phone: company.phone } : {}),
                },
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
          let legalIdentity:
            { ico: string; name: string; sourceUrl: string } | undefined;
          if (lead.entityType !== 'PERSON') {
            try {
              const ares = await findExactAresCompany(lead.companyName, {
                limit: 10,
              });
              if (ares && !ares.datumZaniku) {
                legalIdentity = {
                  ico: ares.ico,
                  name: ares.obchodniJmeno ?? lead.companyName,
                  sourceUrl: `https://ares.gov.cz/ekonomicke-subjekty?ico=${encodeURIComponent(ares.ico)}`,
                };
              }
            } catch (error) {
              this.logger.warn(
                { err: error, leadId: lead.id },
                'ARES verification failed; website analysis continues',
              );
            }
          }
          const scoreBreakdown = scoreAuditDetailed(audit, {
            explicitDiscoveryMatch: lead.source === 'GOOGLE_PLACES',
            aresExactMatch: Boolean(legalIdentity),
          });
          const score = scoreBreakdown.total;
          const discoveryMetadata = discoveryMetadataSchema.safeParse(
            lead.sourceData,
          );
          const metadata = discoveryMetadata.success
            ? discoveryMetadata.data
            : undefined;
          const classificationPhone = audit.foundPhone ?? metadata?.phone;
          const country = detectCountry({
            ...(lead.location ? { address: lead.location } : {}),
            ...(legalIdentity ? { registrationCountryCode: 'CZ' } : {}),
            ...(metadata?.countryCode
              ? { discoveryCountryCode: metadata.countryCode }
              : {}),
            ...(classificationPhone ? { phone: classificationPhone } : {}),
            websiteUrl: audit.sourceUrl,
          });
          const language = detectLanguage({
            ...(audit.htmlLanguage ? { htmlLanguage: audit.htmlLanguage } : {}),
            alternateLanguages: audit.alternateLanguages,
            ...(metadata?.languageCode
              ? { discoveryLanguage: metadata.languageCode }
              : {}),
            websiteText: `${audit.textExcerpt}\n${audit.contactTextExcerpt ?? ''}`,
          });
          const outreachLanguage = selectOutreachLanguage({
            ...(country ? { country } : {}),
            ...(language ? { language } : {}),
          });
          const facts = verifiedResearchFacts({
            audit,
            ...(legalIdentity ? { legalIdentity } : {}),
          });
          let generatedDraft:
            Awaited<ReturnType<ColdEmailGenerator['generate']>> | undefined;
          if (this.coldEmailGenerator) {
            try {
              generatedDraft = await this.coldEmailGenerator.generate(
                buildColdEmailContext({
                  language: outreachLanguage.language,
                  companyName: lead.companyName,
                  websiteUrl: audit.sourceUrl,
                  ...(lead.location ? { location: lead.location } : {}),
                  ...(country ? { countryCode: country.code } : {}),
                  offer: lead.campaign.offer,
                  facts,
                }),
              );
            } catch (error) {
              this.logger.warn(
                { err: error, leadId: lead.id },
                'Cold-email generation failed validation; deterministic draft retained',
              );
            }
          }
          const draft =
            generatedDraft ??
            draftOutreach(
              lead.companyName,
              lead.campaign.offer,
              audit,
              lead.campaign.subjectTemplate,
              lead.campaign.bodyTemplate,
            );
          const draftCreatedAt = new Date();
          await this.store.markAnalyzed(lead.id, {
            domain: new URL(audit.sourceUrl).hostname.replace(/^www\./u, ''),
            ...(legalIdentity ? { registrationId: legalIdentity.ico } : {}),
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
              discoverySource: lead.source,
              scoreBreakdown,
              legalIdentity: legalIdentity ?? null,
              country: country ?? null,
              language: language ?? null,
              outreachLanguage,
              verifiedFacts: facts,
            },
            ...(country ? { country } : {}),
            ...(language ? { language } : {}),
            outreachLanguage,
            baseScore: score,
            llmAdjustment: 0,
            finalScore: score,
            draftSubject: draft.subject,
            draftBody: draft.body,
            draftMetadata: {
              promptVersion: generatedDraft
                ? COLD_EMAIL_PROMPT_VERSION
                : 'deterministic-template',
              model: generatedDraft
                ? (this.coldEmailModel ?? 'unknown')
                : 'none',
              ...(generatedDraft?.personalizationFact
                ? {
                    personalizationFact: generatedDraft.personalizationFact,
                  }
                : {}),
              generationConfidence: generatedDraft?.confidence ?? 1,
              insufficientPersonalizationData:
                generatedDraft?.insufficientPersonalizationData ??
                facts.length === 0,
              createdAt: draftCreatedAt,
            },
            minimumLeadScore: lead.campaign.minimumLeadScore,
          });
          result.analyzed += 1;
          if (this.twenty) {
            try {
              const domain = new URL(audit.sourceUrl).hostname.replace(
                /^www\./u,
                '',
              );
              let companyId: string | undefined;
              let personId: string | undefined;
              if (lead.entityType === 'PERSON') {
                const [firstName, ...lastNameParts] = lead.companyName
                  .trim()
                  .split(/\s+/u);
                const person = await this.twenty.upsertPerson({
                  firstName: firstName ?? lead.companyName,
                  ...(lastNameParts.length > 0
                    ? { lastName: lastNameParts.join(' ') }
                    : {}),
                  ...(email ? { email } : {}),
                  source: lead.source,
                  ...(lead.sourceUrl ? { sourceUrl: lead.sourceUrl } : {}),
                  externalId: `${lead.source}:${lead.sourceExternalId}`,
                  preferredLanguage: outreachLanguage.language,
                  ...(language ? { detectedLanguages: language.detected } : {}),
                  ...(country ? { countryCode: country.code } : {}),
                });
                personId = person.id;
              } else {
                const company = await this.twenty.upsertCompany({
                  name: lead.companyName,
                  websiteUrl: audit.sourceUrl,
                  domain,
                  ...(legalIdentity
                    ? { registrationId: legalIdentity.ico }
                    : {}),
                  externalId: `${lead.source}:${lead.sourceExternalId}`,
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
                  ...(lead.location ? { location: lead.location } : {}),
                  source: lead.source,
                  ...(lead.sourceUrl ? { sourceUrl: lead.sourceUrl } : {}),
                  leadScore: score,
                  lastResearchedAt: draftCreatedAt,
                });
                companyId = company.id;
              }
              const note = await this.twenty.saveDraftNote({
                externalId: lead.id,
                ...(companyId ? { companyId } : {}),
                ...(personId ? { personId } : {}),
                subject: draft.subject,
                body: draft.body,
                promptVersion: generatedDraft
                  ? COLD_EMAIL_PROMPT_VERSION
                  : 'deterministic-template',
                model: generatedDraft
                  ? (this.coldEmailModel ?? 'unknown')
                  : 'none',
                language: outreachLanguage.language,
                ...(language
                  ? { languageDetectionConfidence: language.confidence }
                  : {}),
                ...(country ? { countryCode: country.code } : {}),
                ...(generatedDraft?.personalizationFact
                  ? {
                      personalizationFact: generatedDraft.personalizationFact,
                    }
                  : {}),
                generationConfidence: generatedDraft?.confidence ?? 1,
                createdAt: draftCreatedAt,
              });
              await this.store.setTwentySyncIds(lead.id, {
                ...(companyId ? { companyId } : {}),
                ...(personId ? { personId } : {}),
                draftNoteId: note.id,
              });
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
      this.logger.info(result, 'Sales pipeline run completed');
      return result;
    } finally {
      this.running = false;
    }
  }
}
