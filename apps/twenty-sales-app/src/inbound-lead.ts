export type InboundLeadSource = 'CONTACT_FORM' | 'EMAIL' | 'CRM';

export type TwentyPersonRecord = {
  id?: string;
  createdAt?: string;
  personType?: string | null;
  leadSource?: string | null;
  name?: {
    firstName?: string | null;
    lastName?: string | null;
  } | null;
  emails?: { primaryEmail?: string | null } | null;
  phones?: {
    primaryPhoneNumber?: string | null;
    primaryPhoneCallingCode?: string | null;
    primaryPhoneCountryCode?: string | null;
  } | null;
  company?: { name?: string | null } | null;
  jobTitle?: string | null;
  createdBy?: {
    source?: string | null;
    workspaceMemberId?: string | null;
  } | null;
};

const normalizeSource = (value: string | null | undefined): string =>
  (value ?? '')
    .trim()
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]+/gu, '_')
    .replaceAll(/^_+|_+$/gu, '');

const contactFormSources = new Set([
  'CONTACT_FORM',
  'INBOUND_CONTACT_FORM',
  'WEBSITE_CONTACT_FORM',
  'WEB_CONTACT_FORM',
  'WEB_FORM',
]);

const watcherManagedPersonSources = new Set([
  'MAILBOX_EMAIL',
  'MAILBOX_CONTACT_FORM',
  'ARES',
  'GEOAPIFY',
  'GOOGLE_PLACES',
  'SALES_PROSPECT',
  'LINK_TO_LEAD',
]);

export const classifyInboundLead = (
  person: TwentyPersonRecord,
): InboundLeadSource | undefined => {
  const createdBy = normalizeSource(person.createdBy?.source);
  const leadSource = normalizeSource(person.leadSource);

  if (watcherManagedPersonSources.has(leadSource)) return undefined;
  if (createdBy === 'EMAIL') return 'EMAIL';
  if (contactFormSources.has(leadSource)) return 'CONTACT_FORM';
  return 'CRM';
};

const present = (value: string | null | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

export const buildInboundLeadPayload = (input: {
  eventId: string;
  occurredAt: string;
  source: InboundLeadSource;
  recordId: string;
  person: TwentyPersonRecord;
}) => {
  const firstName = present(input.person.name?.firstName);
  const lastName = present(input.person.name?.lastName);
  const name = [firstName, lastName].filter(Boolean).join(' ') || undefined;
  const callingCode = present(input.person.phones?.primaryPhoneCallingCode);
  const phoneNumber = present(input.person.phones?.primaryPhoneNumber);
  const phone =
    [callingCode, phoneNumber].filter(Boolean).join(' ') || undefined;

  return {
    eventId: input.eventId,
    occurredAt: input.occurredAt,
    eventType: 'PERSON_CREATED' as const,
    source: input.source,
    record: {
      id: input.recordId,
      ...(name ? { name } : {}),
      ...(present(input.person.emails?.primaryEmail)
        ? { email: present(input.person.emails?.primaryEmail) }
        : {}),
      ...(phone ? { phone } : {}),
      ...(present(input.person.company?.name)
        ? { companyName: present(input.person.company?.name) }
        : {}),
      ...(present(input.person.jobTitle)
        ? { jobTitle: present(input.person.jobTitle) }
        : {}),
    },
  };
};

export type TwentyNoteRecord = {
  id?: string;
  createdAt?: string;
  title?: string | null;
  bodyV2?: {
    markdown?: string | null;
    blocknote?: string | null;
  } | null;
};

const watcherNotePrefixes = ['[sales-draft:', '[sales-interaction:'] as const;

export const isWatcherManagedNote = (note: TwentyNoteRecord): boolean => {
  const title = note.title?.trim().toLocaleLowerCase('en') ?? '';
  return watcherNotePrefixes.some((prefix) => title.startsWith(prefix));
};

const bounded = (
  value: string | null | undefined,
  max: number,
): string | undefined => {
  const normalized = value
    ?.replaceAll(/\p{Cc}+/gu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim()
    .slice(0, max);
  return normalized || undefined;
};

export const buildInboundNotePayload = (input: {
  eventId: string;
  occurredAt: string;
  recordId: string;
  note: TwentyNoteRecord;
}) => ({
  eventId: input.eventId,
  occurredAt: input.occurredAt,
  eventType: 'NOTE_CREATED' as const,
  source: 'CRM' as const,
  record: {
    id: input.recordId,
    ...(bounded(input.note.title, 500)
      ? { subject: bounded(input.note.title, 500) }
      : {}),
    ...(bounded(
      input.note.bodyV2?.markdown ?? input.note.bodyV2?.blocknote,
      1_000,
    )
      ? {
          summary: bounded(
            input.note.bodyV2?.markdown ?? input.note.bodyV2?.blocknote,
            1_000,
          ),
        }
      : {}),
  },
});
