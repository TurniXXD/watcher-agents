import type { NetworkContact, NetworkContactInput } from './types.js';

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9@+.]+/gu, ' ')
    .trim();

const emails = (value: string): string[] =>
  [...value.matchAll(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu)].map((match) =>
    match[0].toLowerCase(),
  );

const phones = (value: string): string[] =>
  [...value.matchAll(/\+?\d[\d\s().-]{6,}\d/gu)].map((match) =>
    match[0].replace(/\D/gu, ''),
  );

const urls = (value: string): string[] =>
  [
    ...value.matchAll(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/[^\s,;]+/giu),
  ].map((match) =>
    match[0]
      .replace(/^https?:\/\//u, '')
      .replace(/\/$/u, '')
      .toLowerCase(),
  );

export const findDuplicateContacts = (
  input: NetworkContactInput,
  contacts: NetworkContact[],
): NetworkContact[] => {
  const candidateEmails = new Set(emails(input.email ?? ''));
  const candidatePhones = new Set(phones(input.phone ?? ''));
  const candidateUrls = new Set(urls(input.socialNetwork ?? ''));
  const candidateName = normalize(input.name);

  return contacts.filter((contact) => {
    if (emails(contact.email ?? '').some((email) => candidateEmails.has(email)))
      return true;
    if (phones(contact.phone ?? '').some((phone) => candidatePhones.has(phone)))
      return true;
    if (urls(contact.socialNetwork ?? '').some((url) => candidateUrls.has(url)))
      return true;
    return (
      candidateName.length >= 3 && normalize(contact.name) === candidateName
    );
  });
};
