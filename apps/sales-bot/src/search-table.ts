import { createHash } from 'node:crypto';
import type { BusinessSearchResult } from './discovery-types.js';

export const salesSearchTableHeader = [
  'Jméno',
  'Datum potkání',
  'Místo potkání',
  'Telefon',
  'Email',
  'Web',
  'sociální síť',
  'Poznámka k potkání',
  'Typ kontaktu',
  'Domluvena další schůzka',
  'Aktivní kontakt',
].join('\t');

const cell = (value: string | undefined, maxLength = 300): string =>
  (value ?? '')
    .replaceAll(/[\t\r\n]+/gu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim()
    .slice(0, maxLength);

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

const websiteIdentity = (
  websiteUrl: string | undefined,
): string | undefined => {
  if (!websiteUrl) return undefined;
  try {
    return new URL(websiteUrl).hostname.replace(/^www\./u, '').toLowerCase();
  } catch {
    return undefined;
  }
};

export const salesSearchResultKey = (company: BusinessSearchResult): string => {
  const domain = websiteIdentity(company.websiteUrl);
  const identity = company.registrationId
    ? `ico:${company.registrationId}`
    : domain
      ? `domain:${domain}`
      : `${company.provider}:${company.id}`;
  return createHash('sha256').update(identity).digest('hex');
};

export const salesSearchTableRow = (
  company: BusinessSearchResult,
  query: string,
  locality: string,
): string => {
  const note = [
    `Automaticky nalezený lead pro ${locality}.`,
    company.address ? `Adresa: ${company.address}.` : undefined,
    `Zdroj: ${company.provider}.`,
    company.registrationId ? `IČO: ${company.registrationId}.` : undefined,
    company.naceCodes?.length
      ? `CZ-NACE: ${company.naceCodes.join(', ')}.`
      : undefined,
    `Detail zdroje: ${company.sourceUrl}`,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' ');
  return [
    cell(company.name),
    '',
    '',
    cell(company.phone),
    cell(company.email),
    cell(company.websiteUrl),
    '',
    cell(note, 700),
    cell(query),
    '',
    'ANO',
  ].join('\t');
};

export const renderSalesSearchTableMessages = (
  companies: readonly BusinessSearchResult[],
  query: string,
  locality: string,
  maxLength = 3_800,
): string[] => {
  if (companies.length === 0) return [];
  const rows = companies.map((company) =>
    salesSearchTableRow(company, query, locality),
  );
  const messages: string[] = [];
  let selected: string[] = [];
  const render = (values: readonly string[]) =>
    `<pre>${escapeHtml([salesSearchTableHeader, ...values].join('\n'))}</pre>`;
  for (const row of rows) {
    if (selected.length > 0 && render([...selected, row]).length > maxLength) {
      messages.push(render(selected));
      selected = [];
    }
    selected.push(row);
  }
  if (selected.length > 0) messages.push(render(selected));
  return messages;
};
