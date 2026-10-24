import { createHash } from 'node:crypto';
import { assertPublicHttpUrlResolved } from '@watcher/core';
import type { SalesStore } from '@watcher/database';
import { splitTelegramMessage } from '@watcher/telegram';
import type { ColdEmailGenerator } from './cold-email-generator.js';
import {
  buildColdEmailContext,
  verifiedResearchFacts,
} from './lead-context.js';
import { auditWebsite, draftOutreach, type SiteAudit } from './providers.js';

export const salesIntelligenceKind = 'SALES_DAILY_INTELLIGENCE';
const ttlMs = 14 * 24 * 60 * 60_000;
export type IntelligenceLead = NonNullable<
  Awaited<ReturnType<SalesStore['getLeadWithResearch']>>
>;

export const intelligenceSlotAt = (
  now: Date,
  timezone: string,
  deliveryTime: string,
): string | undefined => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return undefined;
  const [hour, minute] = deliveryTime.split(':').map(Number);
  if (Number(parts.hour) * 60 + Number(parts.minute) < hour! * 60 + minute!)
    return undefined;
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export const normalizeLeadUrl = async (value: string): Promise<URL> => {
  const raw = value.trim();
  if (!raw || raw.length > 2_000)
    throw new Error('Zadej jednu platnou veřejnou URL.');
  const url = await assertPublicHttpUrlResolved(
    /^[a-z][a-z\d+.-]*:/iu.test(raw) ? raw : `https://${raw}`,
  );
  url.hash = '';
  url.username = '';
  url.password = '';
  return url;
};

const companyNameFromAudit = (url: URL, audit: SiteAudit): string =>
  audit.title.split(/[|–—-]/u)[0]?.trim() ||
  url.hostname.replace(/^www\./u, '').split('.')[0] ||
  url.hostname;

const opportunitiesFrom = (audit: SiteAudit) => {
  const values: Array<Record<string, string>> = [];
  if (!audit.hasMobileViewport)
    values.push({
      title: 'Mobilní modernizace webu',
      relevance: 'HIGH',
      findingType: 'verified_finding',
      evidence: 'Domovská stránka nemá viewport deklaraci.',
      impact: 'Mobilní návštěvníci mohou mít zhoršené používání.',
      solution: 'Responzivní audit a cílená modernizace.',
      confidence: 'high',
    });
  if (!audit.hasDescription || (audit.headingCount ?? 0) === 0)
    values.push({
      title: 'Technické SEO',
      relevance: 'MEDIUM',
      findingType: 'verified_finding',
      evidence: `${audit.hasDescription ? 'Meta description nalezena' : 'Meta description chybí'}; nadpisů: ${audit.headingCount}.`,
      impact: 'Horší srozumitelnost stránky pro vyhledávače.',
      solution: 'Technický SEO audit a oprava šablon.',
      confidence: 'high',
    });
  if ((audit.imagesMissingAlt ?? 0) > 0 || (audit.formsMissingLabels ?? 0) > 0)
    values.push({
      title: 'Přístupnost webu',
      relevance: 'MEDIUM',
      findingType: 'potential_issue',
      evidence: `Obrázky bez alt: ${audit.imagesMissingAlt ?? 0}; prvky formulářů bez zjevného popisku: ${audit.formsMissingLabels ?? 0}.`,
      impact: 'Možné bariéry pro uživatele asistivních technologií.',
      solution: 'WCAG audit a opravy komponent.',
      confidence: 'medium',
    });
  if (!audit.usesHttps || audit.hasMixedContent)
    values.push({
      title: 'Bezpečnost transportu',
      relevance: 'HIGH',
      findingType: 'verified_finding',
      evidence: audit.hasMixedContent
        ? 'Na HTTPS stránce jsou odkazy na HTTP zdroje.'
        : 'Web nebyl načten přes HTTPS.',
      impact: 'Nižší důvěra a možné blokování obsahu.',
      solution: 'HTTPS a mixed-content náprava.',
      confidence: 'high',
    });
  if (values.length === 0)
    values.push({
      title: 'Úvodní technický discovery audit',
      relevance: 'LOW',
      findingType: 'business_hypothesis',
      evidence: 'Veřejná kontrola neodhalila výrazný základní problém.',
      impact: 'Příležitost musí potvrdit rozhovor.',
      solution: 'Krátký audit priorit bez závazku.',
      confidence: 'low',
    });
  return values;
};

export class SalesIntelligenceService {
  public constructor(
    private readonly store: SalesStore,
    private readonly generator?: ColdEmailGenerator,
    private readonly crmBaseUrl?: string,
  ) {}

  public async link(urlValue: string): Promise<IntelligenceLead> {
    const url = await normalizeLeadUrl(urlValue);
    const domain = url.hostname.replace(/^www\./u, '').toLowerCase();
    let lead = await this.store.findLeadByDomain(domain);
    if (!lead) {
      const campaign = await this.store.ensureIntelligenceCampaign();
      lead = (await this.store.discoverLead({
        campaignId: campaign.id,
        source: 'TELEGRAM_URL',
        sourceExternalId: createHash('sha256').update(domain).digest('hex'),
        companyName: domain,
        websiteUrl: url.toString(),
        sourceUrl: url.toString(),
      })) as Awaited<ReturnType<SalesStore['findLeadByDomain']>>;
    }
    if (!lead) throw new Error('Lead se nepodařilo vytvořit.');
    return this.research(lead.id, true);
  }

  public async research(
    leadId: string,
    force = false,
  ): Promise<IntelligenceLead> {
    const lead = await this.store.getLeadWithResearch(leadId);
    if (!lead) throw new Error('Lead nebyl nalezen.');
    if (!force && lead.research && lead.research.expiresAt > new Date())
      return lead;
    if (!lead.websiteUrl) throw new Error('Lead nemá veřejný web.');
    const normalizedUrl = await normalizeLeadUrl(lead.websiteUrl);
    const audit = await auditWebsite(normalizedUrl.toString());
    const companyName =
      lead.companyName || companyNameFromAudit(normalizedUrl, audit);
    const facts = verifiedResearchFacts({ audit });
    const opportunities = opportunitiesFrom(audit);
    const language = /^(cs|sk)/iu.test(audit.htmlLanguage ?? '') ? 'cs' : 'en';
    const generated = this.generator
      ? await this.generator
          .generate(
            buildColdEmailContext({
              language,
              companyName,
              websiteUrl: audit.sourceUrl,
              offer: lead.campaign.offer,
              facts,
            }),
          )
          .catch(() => undefined)
      : undefined;
    const draft =
      generated ??
      draftOutreach(
        companyName,
        lead.campaign.offer,
        audit,
        lead.campaign.subjectTemplate,
        lead.campaign.bodyTemplate,
      );
    const researchedAt = new Date();
    const contacts = [
      ...(audit.foundEmail
        ? [
            {
              type: 'general_email',
              value: audit.foundEmail,
              sourceUrl: audit.emailSourceUrl,
              verificationStatus: 'verified_public',
              lastVerifiedAt: researchedAt,
            },
          ]
        : []),
      ...(audit.foundPhone
        ? [
            {
              type: 'business_phone',
              value: audit.foundPhone,
              sourceUrl: audit.phoneSourceUrl,
              verificationStatus: 'verified_public',
              lastVerifiedAt: researchedAt,
            },
          ]
        : []),
      ...(audit.contactPageUrl
        ? [
            {
              type: 'contact_page',
              value: audit.contactPageUrl,
              sourceUrl: audit.contactPageUrl,
              verificationStatus: 'verified_public',
              lastVerifiedAt: researchedAt,
            },
          ]
        : []),
    ];
    const profile = {
      companyName,
      website: audit.sourceUrl,
      canonicalDomain: normalizedUrl.hostname.replace(/^www\./u, ''),
      description: audit.textExcerpt.slice(0, 500),
      industry: null,
      businessModel: null,
      productsAndServices: [],
      targetCustomers: [],
      geographicMarket: null,
      location: lead.location ?? null,
      estimatedCompanySize: null,
    };
    const outreach = {
      recommendedChannel: audit.foundEmail
        ? 'email'
        : audit.foundPhone
          ? 'phone'
          : 'contact_page',
      bestContact:
        audit.foundEmail ?? audit.foundPhone ?? audit.contactPageUrl ?? null,
      primaryOffer: opportunities[0]?.title ?? lead.campaign.offer,
      angle: opportunities[0]?.evidence ?? facts[0] ?? 'Úvodní technický audit',
      conversationOpener:
        facts[0] ?? 'Rád bych ověřil, zda dává technická konzultace smysl.',
      subject: draft.subject,
      body: draft.body,
      language,
    };
    const technicalAudit = {
      ...audit,
      performance: {
        status: 'unavailable',
        reason:
          'PageSpeed integration is not configured; no metrics were invented.',
      },
    };
    const sourceUrls = [
      ...new Set(
        [
          audit.sourceUrl,
          audit.emailSourceUrl,
          audit.phoneSourceUrl,
          audit.contactPageUrl,
        ].filter((value): value is string => Boolean(value)),
      ),
    ];
    await this.store.saveResearch(lead.id, {
      profile,
      contacts,
      technicalAudit,
      opportunities,
      outreach,
      sourceUrls,
      researchedAt,
      expiresAt: new Date(researchedAt.getTime() + ttlMs),
    });
    await this.store.enrichLeadFromResearch(lead.id, {
      companyName,
      websiteUrl: audit.sourceUrl,
      domain: normalizedUrl.hostname.replace(/^www\./u, ''),
      ...(audit.foundEmail
        ? { email: audit.foundEmail, contactSourceUrl: audit.emailSourceUrl }
        : {}),
      ...(audit.foundPhone
        ? { phone: audit.foundPhone, phoneSourceUrl: audit.phoneSourceUrl }
        : {}),
      audit: technicalAudit,
      analysis: { profile, opportunities, sourceUrls, researchedAt },
      draftSubject: draft.subject,
      draftBody: draft.body,
    });
    return this.store.getLeadWithResearch(lead.id).then((value) => value!);
  }

  public crmUrl(lead: {
    id: string;
    twentyCompanyId: string | null;
  }): string | undefined {
    return this.crmBaseUrl
      ? `${this.crmBaseUrl.replace(/\/$/u, '')}/objects/companies/${lead.twentyCompanyId ?? lead.id}`
      : undefined;
  }
}

const json = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const list = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === 'object'),
      )
    : [];

export const renderLeadIntelligence = (
  lead: IntelligenceLead,
  position?: string,
  crmUrl?: string,
): string[] => {
  const research = lead.research;
  if (!research) return [`${lead.companyName}\nVýzkum zatím není dostupný.`];
  const profile = json(research.profile);
  const outreach = json(research.outreach);
  const audit = json(research.technicalAudit);
  const contacts = list(research.contacts);
  const opportunities = list(research.opportunities);
  const contactLines = contacts.length
    ? contacts.map(
        (item) =>
          `- ${String(item.type)}: ${String(item.value)} (${String(item.verificationStatus)})`,
      )
    : ['- Nedostupné'];
  const opportunityLines = opportunities.map(
    (item, index) =>
      `${index + 1}. ${String(item.title)} — ${String(item.relevance)}\nDůkaz: ${String(item.evidence)}\nDopad: ${String(item.impact)}\nŘešení: ${String(item.solution)}\nJistota: ${String(item.confidence)}`,
  );
  const message = `🎯 ${position ? `LEAD ${position} — ` : ''}${lead.companyName}\n\n🏢 Firma\nWeb: ${lead.websiteUrl ?? 'nedostupný'}\nPopis: ${String(profile.description ?? 'nedostupný')}\nCRM stav: ${lead.stage}\nVýzkum: ${research.researchedAt.toISOString()}\n\n📞 Kontakty\n${contactLines.join('\n')}\n\n🔍 Technická analýza\nHTTPS: ${String(audit.usesHttps ?? 'nedostupné')}\nMobile viewport: ${String(audit.hasMobileViewport ?? 'nedostupné')}\nMeta description: ${String(audit.hasDescription ?? 'nedostupné')}\nNadpisy: ${String(audit.headingCount ?? 'nedostupné')}\nObrázky bez alt: ${String(audit.imagesMissingAlt ?? 'nedostupné')}\nTechnologie: ${Array.isArray(audit.detectedTechnologies) && audit.detectedTechnologies.length ? audit.detectedTechnologies.join(', ') : 'nezjištěny'}\nPerformance: bez PageSpeed měření\n\n💡 Příležitosti\n${opportunityLines.join('\n\n')}\n\n🎯 Doporučený přístup\nKanál: ${String(outreach.recommendedChannel)}\nNabídka: ${String(outreach.primaryOffer)}\nÚhel: ${String(outreach.angle)}\nOtvírák: ${String(outreach.conversationOpener)}\n\n✉️ Návrh e-mailu\nPředmět: ${String(outreach.subject)}\n${String(outreach.body)}\n\n🔗 Zdroje\n${research.sourceUrls.map((url) => `- ${url}`).join('\n')}${crmUrl ? `\n\n📋 CRM\n${crmUrl}` : ''}`;
  return splitTelegramMessage(message, 3900);
};
