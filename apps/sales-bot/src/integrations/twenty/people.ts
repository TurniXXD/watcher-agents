import type { TwentyRestClient } from './client.js';
import { filterAnd, filterEquals } from './deduplication.js';
import type { TwentyPersonInput, TwentyRecord } from './types.js';

export const findPerson = async (
  client: TwentyRestClient,
  input: TwentyPersonInput,
  useAppFields: boolean,
): Promise<TwentyRecord | undefined> => {
  if (input.email) {
    const byEmail = await client.find(
      'people',
      filterEquals('emails.primaryEmail', input.email.toLowerCase()),
    );
    if (byEmail) return byEmail;
  }
  if (useAppFields && input.externalId) {
    const byExternalId = await client.find(
      'people',
      filterEquals('externalId', input.externalId),
    );
    if (byExternalId) return byExternalId;
  }
  if (useAppFields && input.sourceUrl) {
    const byProfile = await client.find(
      'people',
      filterEquals('sourceUrl.primaryLinkUrl', input.sourceUrl),
    );
    if (byProfile) return byProfile;
  }
  if (!input.companyId) return undefined;
  return client.find(
    'people',
    filterAnd(
      filterEquals('name.firstName', input.firstName),
      filterEquals('name.lastName', input.lastName ?? ''),
      filterEquals('companyId', input.companyId),
    ),
  );
};

export const upsertPerson = async (
  client: TwentyRestClient,
  input: TwentyPersonInput,
  useAppFields: boolean,
): Promise<TwentyRecord> => {
  const data: Record<string, unknown> = {
    name: { firstName: input.firstName, lastName: input.lastName ?? '' },
    ...(input.email
      ? {
          emails: {
            primaryEmail: input.email.toLowerCase(),
            additionalEmails: [],
          },
        }
      : {}),
    ...(input.companyId ? { companyId: input.companyId } : {}),
    ...(useAppFields
      ? {
          personType: 'LEAD',
          leadSource: input.source,
          ...(input.sourceUrl
            ? {
                sourceUrl: {
                  primaryLinkUrl: input.sourceUrl,
                  primaryLinkLabel: 'Source',
                  secondaryLinks: [],
                },
              }
            : {}),
          ...(input.externalId ? { externalId: input.externalId } : {}),
          ...(input.preferredLanguage
            ? { preferredLanguage: input.preferredLanguage }
            : {}),
          ...(input.detectedLanguages
            ? { detectedLanguages: input.detectedLanguages }
            : {}),
          ...(input.countryCode ? { countryCode: input.countryCode } : {}),
        }
      : {}),
  };
  const existing = await findPerson(client, input, useAppFields);
  return existing
    ? client.update('people', 'person', existing.id, data)
    : client.create('people', 'person', data);
};
