import type { TwentyRestClient } from './client.js';
import {
  canonicalDomainUrl,
  filterAnd,
  filterEquals,
} from './deduplication.js';
import type { TwentyCompanyInput, TwentyRecord } from './types.js';

const appFields = (input: TwentyCompanyInput): Record<string, unknown> => ({
  ...(input.registrationId ? { registrationId: input.registrationId } : {}),
  ...(input.externalId ? { externalId: input.externalId } : {}),
  ...(input.countryCode ? { countryCode: input.countryCode } : {}),
  ...(input.primaryLanguage ? { primaryLanguage: input.primaryLanguage } : {}),
  ...(input.detectedLanguages
    ? { detectedLanguages: input.detectedLanguages }
    : {}),
  ...(input.languageConfidence !== undefined
    ? { languageConfidence: input.languageConfidence }
    : {}),
  ...(input.languageDetectionSource
    ? { languageDetectionSource: input.languageDetectionSource }
    : {}),
  ...(input.countryConfidence !== undefined
    ? { countryConfidence: input.countryConfidence }
    : {}),
  ...(input.countryDetectionSource
    ? { countryDetectionSource: input.countryDetectionSource }
    : {}),
  ...(input.source ? { leadSource: input.source } : {}),
  ...(input.sourceUrl
    ? {
        sourceUrl: {
          primaryLinkUrl: input.sourceUrl,
          primaryLinkLabel: 'Discovery source',
          secondaryLinks: [],
        },
      }
    : {}),
  ...(input.leadScore !== undefined ? { leadScore: input.leadScore } : {}),
  ...(input.icpScore !== undefined ? { icpScore: input.icpScore } : {}),
  ...(input.industry ? { industry: input.industry } : {}),
  enrichmentStatus: 'RESEARCHED',
  lastResearchedAt: input.lastResearchedAt.toISOString(),
});

export const findCompany = async (
  client: TwentyRestClient,
  input: TwentyCompanyInput,
  useAppFields: boolean,
): Promise<TwentyRecord | undefined> => {
  const domainUrl = canonicalDomainUrl(input.domain);
  const byDomain = await client.find(
    'companies',
    filterEquals('domainName.primaryLinkUrl', domainUrl),
  );
  if (byDomain) return byDomain;
  if (useAppFields && input.registrationId) {
    const byRegistration = await client.find(
      'companies',
      filterEquals('registrationId', input.registrationId),
    );
    if (byRegistration) return byRegistration;
  }
  if (useAppFields && input.externalId) {
    const byExternalId = await client.find(
      'companies',
      filterEquals('externalId', input.externalId),
    );
    if (byExternalId) return byExternalId;
  }
  return client.find(
    'companies',
    useAppFields && input.countryCode
      ? filterAnd(
          filterEquals('name', input.name),
          filterEquals('countryCode', input.countryCode),
        )
      : filterEquals('name', input.name),
  );
};

export const upsertCompany = async (
  client: TwentyRestClient,
  input: TwentyCompanyInput,
  useAppFields: boolean,
): Promise<TwentyRecord> => {
  const data = {
    name: input.name,
    domainName: {
      primaryLinkUrl: canonicalDomainUrl(input.domain),
      primaryLinkLabel: 'Website',
      secondaryLinks: [],
    },
    ...(input.location ? { address: { addressStreet1: input.location } } : {}),
    ...(useAppFields ? appFields(input) : {}),
  };
  const existing = await findCompany(client, input, useAppFields);
  return existing
    ? client.update('companies', 'company', existing.id, data)
    : client.create('companies', 'company', data);
};
