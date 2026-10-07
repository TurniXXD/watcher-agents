import type { WatcherLogger } from '@watcher/core';
import type { SalesStore } from '@watcher/database';
import {
  findExactAresCompany,
  searchAresBusinesses,
} from '@watcher/sources/company';
import { z } from 'zod';
import type { ColdEmailGenerator } from './cold-email-generator.js';
import {
  detectCountry,
  detectLanguage,
  normalizeEntityType,
  selectOutreachLanguage,
} from './classification/index.js';
import type { GooglePlacesDiscoveryClient } from './discovery.js';
import type { BusinessSearchResult } from './discovery-types.js';
import { sendEligibility } from './eligibility.js';
import {
  type GeoapifyDiscoveryClient,
  resolveBusinessCategory,
} from './geoapify.js';
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

const safeErrorDetails = (error: unknown): Record<string, string> => {
  const name = error instanceof Error ? error.name : 'UnknownError';
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = rawMessage.replace(
    /([?&](?:apiKey|key)=)[^&\s]+/giu,
    '$1[redacted]',
  );
  return { errorName: name, errorMessage: message };
};

const normalizedBusinessName = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(
      /\b(?:spol\.?\s*s\s*r\.?\s*o\.?|s\.?\s*r\.?\s*o\.?|a\.?\s*s\.?|v\.?\s*o\.?\s*s\.?)\b/gu,
      '',
    )
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();

const resultKey = (result: BusinessSearchResult): string => {
  if (result.registrationId) return `ico:${result.registrationId}`;
  if (result.websiteUrl) {
    try {
      return `domain:${new URL(result.websiteUrl).hostname.replace(/^www\./u, '').toLowerCase()}`;
    } catch {
      // Fall through to the stable provider/name identity.
    }
  }
  return `name:${normalizedBusinessName(result.name)}:${result.address?.toLowerCase() ?? ''}`;
};

const mergeDiscoveryResults = (
  placeResults: BusinessSearchResult[],
  aresResults: BusinessSearchResult[],
  limit: number,
): BusinessSearchResult[] => {
  const aresByName = new Map(
    aresResults.map((result) => [normalizedBusinessName(result.name), result]),
  );
  const enrichedPlaces = placeResults.map((result) => {
    const ares = aresByName.get(normalizedBusinessName(result.name));
    if (!ares) return result;
    aresByName.delete(normalizedBusinessName(result.name));
    return {
      ...result,
      ...(ares.registrationId ? { registrationId: ares.registrationId } : {}),
      ...(ares.naceCodes ? { naceCodes: ares.naceCodes } : {}),
    };
  });
  const deduplicated = new Map<string, BusinessSearchResult>();
  for (const result of [...enrichedPlaces, ...aresByName.values()]) {
    const key = resultKey(result);
    if (!deduplicated.has(key)) deduplicated.set(key, result);
  }
  return [...deduplicated.values()].slice(0, limit);
};

export class SalesService {
  private running = false;
  public constructor(
    private readonly store: SalesStore,
    private readonly logger: WatcherLogger,
    private readonly quickly?: QuicklyClient,
    private readonly twenty?: TwentyIntegration,
    private readonly geoapify?: GeoapifyDiscoveryClient,
    private readonly places?: GooglePlacesDiscoveryClient,
    private readonly coldEmailGenerator?: ColdEmailGenerator,
    private readonly coldEmailModel?: string,
  ) {}

  public get geoapifyConfigured(): boolean {
    return Boolean(this.geoapify);
  }

  public get googlePlacesConfigured(): boolean {
    return Boolean(this.places);
  }

  public async searchBusinesses(input: {
    query: string;
    locality: string;
    limit: number;
  }): Promise<BusinessSearchResult[]> {
    const category = resolveBusinessCategory(input.query);
    const geoapify = this.geoapify;
    const geoapifyEligible =
      geoapify !== undefined && category.geoapifyCategory !== undefined;
    this.logger.info(
      {
        query: input.query,
        locality: input.locality,
        limit: input.limit,
        aresNaceCode: category.naceCode ?? null,
        geoapifyCategory: category.geoapifyCategory ?? null,
        geoapifyConfigured: this.geoapifyConfigured,
        googleFallbackConfigured: this.googlePlacesConfigured,
      },
      'Sales business search started',
    );
    let aresDurationMs = 0;
    let geoapifyDurationMs = 0;
    const aresOperation = (async () => {
      const startedAt = Date.now();
      try {
        return await searchAresBusinesses({
          ...input,
          ...(category.naceCode ? { naceCode: category.naceCode } : {}),
        });
      } finally {
        aresDurationMs = Date.now() - startedAt;
      }
    })();
    const geoapifyOperation = geoapifyEligible
      ? (async () => {
          const startedAt = Date.now();
          try {
            return await geoapify.search(
              input.query,
              input.locality,
              input.limit,
            );
          } finally {
            geoapifyDurationMs = Date.now() - startedAt;
          }
        })()
      : Promise.resolve([]);
    const primary = await Promise.allSettled([
      aresOperation,
      geoapifyOperation,
    ]);
    const failures: unknown[] = [];
    const aresResults: BusinessSearchResult[] = [];
    if (primary[0].status === 'fulfilled') {
      for (const subject of primary[0].value.subjects) {
        const naceCodes = subject.czNace ?? subject.czNace2008;
        aresResults.push({
          id: subject.ico,
          name: subject.obchodniJmeno ?? subject.ico,
          provider: 'ARES',
          sourceUrl: `https://ares.gov.cz/ekonomicke-subjekty?ico=${encodeURIComponent(subject.ico)}`,
          registrationId: subject.ico,
          ...(subject.sidlo?.textovaAdresa
            ? { address: subject.sidlo.textovaAdresa }
            : {}),
          ...(naceCodes?.length ? { naceCodes } : {}),
        });
      }
      this.logger.info(
        {
          source: 'ARES',
          status: 'completed',
          durationMs: aresDurationMs,
          totalReported: primary[0].value.total,
          candidates: aresResults.length,
          naceCode: category.naceCode ?? null,
          locality: input.locality,
        },
        'Sales discovery source completed',
      );
    } else {
      failures.push(primary[0].reason);
      this.logger.warn(
        {
          source: 'ARES',
          status: 'failed',
          durationMs: aresDurationMs,
          query: input.query,
          locality: input.locality,
          ...safeErrorDetails(primary[0].reason),
        },
        'ARES business discovery failed',
      );
    }
    let placeResults: BusinessSearchResult[] = [];
    if (primary[1].status === 'fulfilled') {
      placeResults = primary[1].value;
      this.logger.info(
        {
          source: 'GEOAPIFY',
          status: geoapifyEligible ? 'completed' : 'skipped',
          skipReason: !this.geoapify
            ? 'not_configured'
            : !category.geoapifyCategory
              ? 'unmapped_category'
              : null,
          durationMs: geoapifyDurationMs,
          category: category.geoapifyCategory ?? null,
          candidates: placeResults.length,
          contactableCandidates: placeResults.filter(
            (result) => result.websiteUrl || result.phone || result.email,
          ).length,
          locality: input.locality,
        },
        'Sales discovery source completed',
      );
    } else {
      failures.push(primary[1].reason);
      this.logger.warn(
        {
          source: 'GEOAPIFY',
          status: 'failed',
          durationMs: geoapifyDurationMs,
          category: category.geoapifyCategory ?? null,
          query: input.query,
          locality: input.locality,
          ...safeErrorDetails(primary[1].reason),
        },
        'Geoapify business discovery failed',
      );
    }

    const contactResults = placeResults.filter(
      (result) => result.websiteUrl || result.phone,
    ).length;
    if (this.places && contactResults < input.limit) {
      const googleStartedAt = Date.now();
      try {
        const googleResults = await this.places.searchDirectory(
          input.query,
          input.locality,
          input.limit - contactResults,
        );
        placeResults = [...placeResults, ...googleResults];
        this.logger.info(
          {
            source: 'GOOGLE_PLACES',
            status: 'completed',
            durationMs: Date.now() - googleStartedAt,
            fallbackReason: 'insufficient_geoapify_contacts',
            requested: input.limit - contactResults,
            candidates: googleResults.length,
          },
          'Sales discovery fallback completed',
        );
      } catch (error) {
        failures.push(error);
        this.logger.warn(
          {
            source: 'GOOGLE_PLACES',
            status: 'failed',
            durationMs: Date.now() - googleStartedAt,
            fallbackReason: 'insufficient_geoapify_contacts',
            ...safeErrorDetails(error),
          },
          'Google Places fallback failed',
        );
      }
    } else {
      this.logger.info(
        {
          source: 'GOOGLE_PLACES',
          status: 'skipped',
          skipReason: !this.places
            ? 'not_configured'
            : 'enough_geoapify_contacts',
          geoapifyContactableCandidates: contactResults,
          requestedLimit: input.limit,
        },
        'Sales discovery fallback skipped',
      );
    }
    const companies = mergeDiscoveryResults(
      placeResults,
      aresResults,
      input.limit,
    );
    if (companies.length === 0 && failures.length > 0)
      throw new AggregateError(
        failures,
        'All configured discovery sources failed',
      );
    this.logger.info(
      {
        query: input.query,
        locality: input.locality,
        candidates: companies.length,
        aresCandidates: aresResults.length,
        geoapifyCandidates: placeResults.filter(
          (result) => result.provider === 'GEOAPIFY',
        ).length,
        googleCandidates: placeResults.filter(
          (result) => result.provider === 'GOOGLE_PLACES',
        ).length,
        contactableCandidates: companies.filter(
          (result) => result.websiteUrl || result.phone || result.email,
        ).length,
        resolvedNaceCode: category.naceCode ?? null,
        resolvedGeoapifyCategory: category.geoapifyCategory ?? null,
        geoapifyConfigured: this.geoapifyConfigured,
        googleFallbackConfigured: this.googlePlacesConfigured,
      },
      'Sales business search completed',
    );
    return companies;
  }

  public async discoverBusinesses(input: {
    campaignId: string;
    query: string;
    locality: string;
    limit: number;
  }): Promise<{ found: number; imported: number }> {
    const campaign = await this.store.getCampaign(input.campaignId);
    if (!campaign) throw new Error('Campaign not found');
    const companies = await this.searchBusinesses(input);
    const importable = companies.filter(
      (company): company is BusinessSearchResult & { websiteUrl: string } =>
        company.websiteUrl !== undefined,
    );
    for (const company of importable) {
      await this.store.discoverLead({
        campaignId: campaign.id,
        source: company.provider,
        sourceExternalId: company.id,
        companyName: company.name,
        entityType: 'COMPANY',
        websiteUrl: company.websiteUrl,
        sourceUrl: company.sourceUrl,
        ...(company.registrationId
          ? { registrationId: company.registrationId }
          : {}),
        ...(company.address ? { location: company.address } : {}),
        sourceData: {
          provider: company.provider,
          ...(company.address ? { address: company.address } : {}),
          ...(company.phone ? { phone: company.phone } : {}),
          ...(company.email ? { email: company.email } : {}),
          ...(company.registrationId
            ? { registrationId: company.registrationId }
            : {}),
          ...(company.naceCodes ? { naceCodes: company.naceCodes } : {}),
        },
      });
    }
    this.logger.info(
      {
        campaignId: campaign.id,
        query: input.query,
        locality: input.locality,
        candidates: companies.length,
        imported: importable.length,
      },
      'Sales business discovery completed',
    );
    return { found: companies.length, imported: importable.length };
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
          aresConfigured: true,
          geoapifyConfigured: this.geoapifyConfigured,
          placesConfigured: this.googlePlacesConfigured,
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
            if (lead.registrationId) {
              legalIdentity = {
                ico: lead.registrationId,
                name: lead.companyName,
                sourceUrl: `https://ares.gov.cz/ekonomicke-subjekty?ico=${encodeURIComponent(lead.registrationId)}`,
              };
            } else {
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
          }
          const scoreBreakdown = scoreAuditDetailed(audit, {
            explicitDiscoveryMatch:
              lead.source === 'GOOGLE_PLACES' || lead.source === 'GEOAPIFY',
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
