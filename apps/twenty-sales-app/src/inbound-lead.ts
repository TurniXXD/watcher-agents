export type InboundLeadSource = 'CONTACT_FORM' | 'EMAIL';

export type TwentyPersonRecord = {
  id?: string;
  createdAt?: string;
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

export type PersonCreatedActor = {
  workspaceMemberId?: string | null;
  userWorkspaceId?: string | null;
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

export const classifyInboundLead = (
  person: TwentyPersonRecord,
  actor: PersonCreatedActor,
): InboundLeadSource | undefined => {
  const createdBy = normalizeSource(person.createdBy?.source);
  const leadSource = normalizeSource(person.leadSource);

  if (createdBy === 'EMAIL') return 'EMAIL';
  if (createdBy === 'MANUAL') return undefined;
  if (contactFormSources.has(leadSource)) return 'CONTACT_FORM';
  if (
    person.createdBy?.workspaceMemberId ||
    actor.workspaceMemberId ||
    actor.userWorkspaceId
  )
    return undefined;
  return undefined;
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
