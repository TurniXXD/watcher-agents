import { createHash } from 'node:crypto';
import type { BusinessSearchResult } from './discovery-types.js';
import type { BusinessCategoryTranslation } from './geoapify.js';

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

const salesSearchTableLabels = salesSearchTableHeader.split('\t');
const labelWidth = 23;
const valueWidth = 34;

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

const translationSourceLabel = (
  source: BusinessCategoryTranslation['source'],
): string =>
  ({
    explicit: 'explicitní kód',
    rule: 'slovník',
    ai: 'AI překladač',
    unresolved: 'bez překladu',
  })[source];

export const salesSearchCategorySummary = (
  query: string,
  category: BusinessCategoryTranslation,
): string => {
  const geoapifyCategories = category.geoapifyCategory
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return [
    `Překlad oboru „${query}“: ${translationSourceLabel(category.source)}`,
    `Geoapify kategorie: ${geoapifyCategories?.join(', ') || 'nenalezena'}`,
    `CZ-NACE: ${category.naceCode ?? 'nepoužit'}`,
  ].join('\n');
};

const salesSearchCategorySummaryHtml = (
  query: string,
  category: BusinessCategoryTranslation,
): string =>
  `<b>Vyhledávané kategorie</b>\n${escapeHtml(salesSearchCategorySummary(query, category))}`;

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

const wrapCell = (value: string, width: number): string[] => {
  if (!value) return [''];
  const lines: string[] = [];
  let remaining = value;
  while (remaining.length > width) {
    const candidate = remaining.slice(0, width + 1);
    const lastSpace = candidate.lastIndexOf(' ');
    const splitAt = lastSpace > 0 ? lastSpace : width;
    lines.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }
  lines.push(remaining);
  return lines;
};

const renderContactTable = (
  company: BusinessSearchResult,
  query: string,
  locality: string,
  index: number,
): string => {
  const values = salesSearchTableRow(company, query, locality).split('\t');
  const horizontal = `├${'─'.repeat(labelWidth)}┼${'─'.repeat(valueWidth)}┤`;
  const lines = [
    `Kontakt ${index}`,
    `┌${'─'.repeat(labelWidth)}┬${'─'.repeat(valueWidth)}┐`,
  ];
  for (const [rowIndex, label] of salesSearchTableLabels.entries()) {
    const wrapped = wrapCell(values[rowIndex] ?? '', valueWidth);
    for (const [lineIndex, value] of wrapped.entries()) {
      lines.push(
        `│${(lineIndex === 0 ? label : '').padEnd(labelWidth)}│${value.padEnd(valueWidth)}│`,
      );
    }
    if (rowIndex < salesSearchTableLabels.length - 1) lines.push(horizontal);
  }
  lines.push(`└${'─'.repeat(labelWidth)}┴${'─'.repeat(valueWidth)}┘`);
  return `<pre>${escapeHtml(lines.join('\n'))}</pre>`;
};

export const renderSalesSearchTableMessages = (
  companies: readonly BusinessSearchResult[],
  query: string,
  locality: string,
  category?: BusinessCategoryTranslation,
  maxLength = 3_800,
): string[] => {
  if (companies.length === 0) return [];
  const tables = companies.map((company, index) =>
    renderContactTable(company, query, locality, index + 1),
  );
  const messages: string[] = [];
  let selected: string[] = [];
  const render = (values: readonly string[]) => values.join('\n\n');
  for (const table of tables) {
    if (
      selected.length > 0 &&
      render([...selected, table]).length > maxLength
    ) {
      messages.push(render(selected));
      selected = [];
    }
    selected.push(table);
  }
  if (selected.length > 0) messages.push(render(selected));
  if (category && messages[0]) {
    messages[0] = `${salesSearchCategorySummaryHtml(query, category)}\n\n${messages[0]}`;
  }
  return messages;
};
