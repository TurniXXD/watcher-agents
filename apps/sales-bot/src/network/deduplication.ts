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
  const candidateContact = input.contact ?? '';
  const candidateEmails = new Set(emails(candidateContact));
  const candidatePhones = new Set(phones(candidateContact));
  const candidateUrls = new Set(urls(candidateContact));
  const candidateName = normalize(input.name);

  return contacts.filter((contact) => {
    const existingContact = contact.contact ?? '';
    if (emails(existingContact).some((email) => candidateEmails.has(email)))
      return true;
    if (phones(existingContact).some((phone) => candidatePhones.has(phone)))
      return true;
    if (urls(existingContact).some((url) => candidateUrls.has(url)))
      return true;
    return (
      candidateName.length >= 3 && normalize(contact.name) === candidateName
    );
  });
};
