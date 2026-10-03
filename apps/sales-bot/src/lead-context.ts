import type { ColdEmailContext } from './prompts/cold-email/index.js';
import type { SupportedLanguage } from './classification/index.js';
import type { SiteAudit } from './providers.js';

export const verifiedResearchFacts = (input: {
  audit: SiteAudit;
  legalIdentity?: { ico: string; name: string; sourceUrl: string };
}): string[] => {
  const facts: string[] = [];
  if (input.audit.title) {
    facts.push(`The public website title is "${input.audit.title}".`);
  }
  if (input.audit.hasContactPage) {
    facts.push('The public website includes a contact page.');
  }
  if (!input.audit.hasMobileViewport) {
    facts.push('The homepage does not declare a mobile viewport.');
  }
  if (!input.audit.hasDescription) {
    facts.push('The homepage does not expose a meta description.');
  }
  if (input.legalIdentity) {
    facts.push(
      `ARES lists the company as "${input.legalIdentity.name}" with registration ID ${input.legalIdentity.ico}.`,
    );
  }
  return facts;
};

export const buildColdEmailContext = (input: {
  language: SupportedLanguage;
  companyName: string;
  websiteUrl: string;
  location?: string;
  countryCode?: string;
  offer: string;
  facts: string[];
}): ColdEmailContext => ({
  language: input.language,
  lead: { firstName: '' },
  company: {
    name: input.companyName,
    website: input.websiteUrl,
    ...(input.location ? { location: input.location } : {}),
    ...(input.countryCode ? { countryCode: input.countryCode } : {}),
  },
  research: { facts: input.facts },
  offer: { service: input.offer, capabilities: [] },
});
