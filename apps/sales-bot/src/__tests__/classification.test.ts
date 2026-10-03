import { describe, expect, it } from 'vitest';
import {
  detectCountry,
  detectLanguage,
  normalizeEntityType,
  selectOutreachLanguage,
} from '../classification/index.js';

describe('entity normalization', () => {
  it('normalizes supported person aliases and defaults business sources to company', () => {
    expect(normalizeEntityType('individual')).toBe('PERSON');
    expect(normalizeEntityType('sole trader')).toBe('PERSON');
    expect(normalizeEntityType('organization')).toBe('COMPANY');
    expect(normalizeEntityType(undefined)).toBe('COMPANY');
  });
});

describe('country detection', () => {
  it('prefers an explicit Czech company address', () => {
    expect(detectCountry({ address: 'Veveří 10, Brno, Česko' })).toMatchObject({
      code: 'CZ',
      source: 'company_address',
      confidence: 0.98,
    });
  });

  it('treats a .cz domain as a weak signal, not proof', () => {
    expect(detectCountry({ websiteUrl: 'https://example.cz' })).toMatchObject({
      code: 'CZ',
      source: 'domain_tld',
    });
    expect(
      detectCountry({ websiteUrl: 'https://example.cz' })?.confidence,
    ).toBeLessThan(0.7);
  });
});

describe('language detection', () => {
  it.each([
    ['cs-CZ', 'cs'],
    ['en', 'en'],
  ] as const)(
    'uses the explicit website language %s',
    (htmlLanguage, primary) => {
      expect(detectLanguage({ htmlLanguage })).toMatchObject({ primary });
    },
  );

  it('keeps Czech as primary on a Czech-default multilingual site', () => {
    expect(
      detectLanguage({ htmlLanguage: 'cs', alternateLanguages: ['en'] }),
    ).toEqual({
      primary: 'cs',
      detected: ['cs', 'en'],
      confidence: 0.97,
      source: 'website_default_language',
      reason: 'The default website HTML language is explicit',
    });
  });

  it('detects Czech content without relying on the domain', () => {
    expect(
      detectLanguage({
        websiteText:
          'Naše služby a kontaktní údaje jsou na webu. Pro více informací nás kontaktujte, jsme vám k dispozici.',
      }),
    ).toMatchObject({ primary: 'cs', source: 'website_content' });
  });

  it('detects English content without relying on the domain', () => {
    expect(
      detectLanguage({
        websiteText:
          'Our services help your company and the team is available. Contact us for more information about our work.',
      }),
    ).toMatchObject({ primary: 'en', source: 'website_content' });
  });
});

describe('outreach language selection', () => {
  it('lets a confident detected language win', () => {
    expect(
      selectOutreachLanguage({
        country: {
          code: 'CZ',
          name: 'Czechia',
          confidence: 0.98,
          source: 'company_address',
          reason: 'address',
        },
        language: {
          primary: 'de',
          detected: ['de'],
          confidence: 0.96,
          source: 'html_lang',
          reason: 'html lang',
        },
      }),
    ).toMatchObject({
      language: 'de',
      reason: 'primary_website_language',
    });
  });

  it('falls back to Czech for a Czech entity without reliable language', () => {
    expect(
      selectOutreachLanguage({
        country: {
          code: 'CZ',
          name: 'Czechia',
          confidence: 0.9,
          source: 'phone_country_code',
          reason: '+420',
        },
      }),
    ).toMatchObject({ language: 'cs', reason: 'czech_entity_fallback' });
  });

  it('falls back to English for an unknown foreign entity', () => {
    expect(selectOutreachLanguage({})).toMatchObject({
      language: 'en',
      reason: 'foreign_entity_fallback',
    });
  });
});
