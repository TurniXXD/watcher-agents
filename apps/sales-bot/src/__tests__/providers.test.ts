import { describe, expect, it } from 'vitest';
import {
  extractPublicPhone,
  scoreAuditDetailed,
  type SiteAudit,
} from '../providers.js';

describe('extractPublicPhone', () => {
  it('uses explicit public tel links only', () => {
    expect(
      extractPublicPhone('<a href="tel:+420%20777%20123%20456">Call</a>'),
    ).toBe('+420 777 123 456');
    expect(extractPublicPhone('Phone: +420 777 123 456')).toBeUndefined();
  });

  it('rejects malformed or too short numbers', () => {
    expect(extractPublicPhone('<a href="tel:123">Call</a>')).toBeUndefined();
    expect(
      extractPublicPhone('<a href="tel:javascript:alert(1)">Call</a>'),
    ).toBeUndefined();
  });
});

describe('scoreAuditDetailed', () => {
  it('keeps fit, need, contactability, and evidence independently auditable', () => {
    const audit: SiteAudit = {
      sourceUrl: 'https://company.example',
      title: 'Company',
      textExcerpt: 'Example',
      alternateLanguages: [],
      hasContactPage: false,
      hasPrivacyPage: false,
      hasMobileViewport: false,
      hasDescription: false,
      foundEmail: 'info@company.example',
      emailSourceUrl: 'https://company.example/contact',
      foundPhone: '+420 777 123 456',
      phoneSourceUrl: 'https://company.example/contact',
    };
    expect(
      scoreAuditDetailed(audit, {
        explicitDiscoveryMatch: true,
        aresExactMatch: true,
      }),
    ).toEqual({
      total: 90,
      fit: 25,
      need: 30,
      contactability: 20,
      evidence: 15,
    });
  });
});
