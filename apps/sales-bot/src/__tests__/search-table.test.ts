import { describe, expect, it } from 'vitest';
import type { BusinessSearchResult } from '../discovery-types.js';
import {
  renderSalesSearchTableMessages,
  salesSearchResultKey,
  salesSearchTableHeader,
  salesSearchTableRow,
} from '../search-table.js';

const company: BusinessSearchResult = {
  id: 'place-1',
  name: 'Studio <Test> & syn',
  provider: 'GEOAPIFY',
  sourceUrl: 'https://example.test/source',
  websiteUrl: 'https://www.example.test',
  address: 'Brno\n-střed',
  phone: '+420 123 456 789',
  email: 'hello@example.test',
  registrationId: '12345678',
  naceCodes: ['71110'],
};

describe('sales search table', () => {
  it('uses the exact requested 11-column header and leaves meeting fields empty', () => {
    expect(salesSearchTableHeader).toBe(
      'Jméno\tDatum potkání\tMísto potkání\tTelefon\tEmail\tWeb\tsociální síť\tPoznámka k potkání\tTyp kontaktu\tDomluvena další schůzka\tAktivní kontakt',
    );
    const cells = salesSearchTableRow(company, 'architekti', 'Brno').split(
      '\t',
    );
    expect(cells).toHaveLength(11);
    expect(cells).toEqual([
      'Studio <Test> & syn',
      '',
      '',
      '+420 123 456 789',
      'hello@example.test',
      'https://www.example.test',
      '',
      expect.stringContaining('Automaticky nalezený lead pro Brno.'),
      'architekti',
      '',
      'ANO',
    ]);
    expect(cells[7]).not.toContain('\n');
  });

  it('escapes Telegram HTML and repeats the header when messages are split', () => {
    const messages = renderSalesSearchTableMessages(
      [company, { ...company, id: 'place-2', registrationId: '87654321' }],
      'architekti',
      'Brno',
      500,
    );
    expect(messages).toHaveLength(2);
    expect(messages.every((message) => message.startsWith('<pre>'))).toBe(true);
    expect(messages.every((message) => message.includes('Jméno\tDatum'))).toBe(
      true,
    );
    expect(messages[0]).toContain('Studio &lt;Test&gt; &amp; syn');
  });

  it('deduplicates primarily by IČO, then normalized domain', () => {
    expect(salesSearchResultKey(company)).toBe(
      salesSearchResultKey({
        id: 'other-source-id',
        name: company.name,
        provider: 'ARES',
        sourceUrl: company.sourceUrl,
        registrationId: '12345678',
      }),
    );
    const companyWithoutRegistration: BusinessSearchResult = {
      id: company.id,
      name: company.name,
      provider: company.provider,
      sourceUrl: company.sourceUrl,
      websiteUrl: 'https://www.example.test',
    };
    expect(salesSearchResultKey(companyWithoutRegistration)).toBe(
      salesSearchResultKey({
        id: 'other-source-id',
        name: company.name,
        provider: company.provider,
        sourceUrl: company.sourceUrl,
        websiteUrl: 'https://example.test/contact',
      }),
    );
  });
});
