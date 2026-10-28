import { createHash } from 'node:crypto';
import type { BusinessSearchResult } from './discovery-types.js';
import type { BusinessCategoryTranslation } from './geoapify.js';

const clean = (value: string | undefined, maxLength = 300): string =>
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

const escapeHtmlAttribute = (value: string): string =>
  escapeHtml(value).replaceAll('"', '&quot;');

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

const httpLink = (label: string, value: string | undefined): string => {
  const visibleLabel = escapeHtml(clean(label, 500));
  if (!value) return visibleLabel;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      return visibleLabel;
    return `<a href="${escapeHtmlAttribute(url.toString())}">${visibleLabel}</a>`;
  } catch {
    return visibleLabel;
  }
};

const line = (label: string, value: string | undefined): string | undefined => {
  const normalized = clean(value);
  return normalized ? `<b>${label}:</b> ${escapeHtml(normalized)}` : undefined;
};

const renderContactListItem = (
  company: BusinessSearchResult,
  query: string,
  locality: string,
  index: number,
): string => {
  const website = clean(company.websiteUrl, 500);
  const sourceUrl = clean(company.sourceUrl, 500);
  return [
    `<b>${index}. ${escapeHtml(clean(company.name, 300))}</b>`,
    line('Obor', query),
    line('Lokalita hledání', locality),
    line('Adresa', company.address),
    line('Telefon', company.phone),
    line('E-mail', company.email),
    website ? `<b>Web:</b> ${httpLink(website, website)}` : undefined,
    line('IČO', company.registrationId),
    company.naceCodes?.length
      ? `<b>CZ-NACE:</b> ${escapeHtml(company.naceCodes.map((value) => clean(value, 30)).join(', '))}`
      : undefined,
    `<b>Zdroj:</b> ${escapeHtml(clean(company.provider, 80))}${
      sourceUrl ? ` · ${httpLink('otevřít detail', sourceUrl)}` : ''
    }`,
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n');
};

export const renderSalesSearchListMessages = (
  companies: readonly BusinessSearchResult[],
  query: string,
  locality: string,
  category?: BusinessCategoryTranslation,
  maxLength = 3_800,
): string[] => {
  if (companies.length === 0) return [];
  const items = companies.map((company, index) =>
    renderContactListItem(company, query, locality, index + 1),
  );
  const messages: string[] = [];
  let selected: string[] = [];
  const render = (values: readonly string[]) => values.join('\n\n');
  for (const item of items) {
    if (selected.length > 0 && render([...selected, item]).length > maxLength) {
      messages.push(render(selected));
      selected = [];
    }
    selected.push(item);
  }
  if (selected.length > 0) messages.push(render(selected));
  if (category && messages[0]) {
    messages[0] = `${salesSearchCategorySummaryHtml(query, category)}\n\n${messages[0]}`;
  }
  return messages;
};
