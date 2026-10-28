import { describe, expect, it } from 'vitest';
import type { BusinessSearchResult } from '../discovery-types.js';
import {
  renderSalesSearchListMessages,
  salesSearchResultKey,
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

describe('sales search list', () => {
  it('renders a compact list with working website and source links', () => {
    const messages = renderSalesSearchListMessages(
      [company, { ...company, id: 'place-2', registrationId: '87654321' }],
      'architekti',
      'Brno',
      undefined,
      500,
    );
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain('<b>1. Studio &lt;Test&gt; &amp; syn</b>');
    expect(messages[0]).toContain(
      '<a href="https://www.example.test/">https://www.example.test</a>',
    );
    expect(messages[0]).toContain(
      '<a href="https://example.test/source">otevřít detail</a>',
    );
    expect(messages[0]).toContain('<b>Telefon:</b> +420 123 456 789');
    expect(messages[0]).toContain('<b>E-mail:</b> hello@example.test');
    expect(messages[0]).not.toMatch(/[│┌┐└┘├┤┬┴┼]/u);
    expect(messages[0]).not.toContain('<pre>');
  });

  it('prints the translated Geoapify and CZ-NACE categories above results', () => {
    const [message] = renderSalesSearchListMessages(
      [company],
      'farmy',
      'Brno',
      {
        geoapifyCategory: 'commercial.food_and_drink.farm',
        naceCode: '01',
        source: 'rule',
      },
    );

    expect(message).toContain(
      'Geoapify kategorie: commercial.food_and_drink.farm',
    );
    expect(message).toContain('CZ-NACE: 01');
    expect(message).toContain('Překlad oboru „farmy“: slovník');
  });

  it('does not turn unsafe URL schemes into Telegram links', () => {
    const [message] = renderSalesSearchListMessages(
      [
        {
          ...company,
          websiteUrl: 'javascript:alert(1)',
          sourceUrl: 'data:text/html,unsafe',
        },
      ],
      'architekti',
      'Brno',
    );

    expect(message).not.toContain('<a href=');
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
