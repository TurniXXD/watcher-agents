import { describe, expect, it } from 'vitest';
import {
  intelligenceSlotAt,
  normalizeLeadUrl,
  renderLeadIntelligence,
} from '../sales-intelligence.js';

describe('sales intelligence', () => {
  it('schedules only Prague working days after the configured time', () => {
    expect(
      intelligenceSlotAt(
        new Date('2026-10-23T07:00:00Z'),
        'Europe/Prague',
        '09:00',
      ),
    ).toBe('2026-10-23');
    expect(
      intelligenceSlotAt(
        new Date('2026-10-24T07:00:00Z'),
        'Europe/Prague',
        '09:00',
      ),
    ).toBeUndefined();
    expect(
      intelligenceSlotAt(
        new Date('2026-10-26T07:59:00Z'),
        'Europe/Prague',
        '09:00',
      ),
    ).toBeUndefined();
    expect(
      intelligenceSlotAt(
        new Date('2026-10-26T08:00:00Z'),
        'Europe/Prague',
        '09:00',
      ),
    ).toBe('2026-10-26');
  });
  it('rejects private targets before fetching', async () => {
    await expect(normalizeLeadUrl('http://127.0.0.1/admin')).rejects.toThrow(
      'Private or special-purpose',
    );
    await expect(
      normalizeLeadUrl('http://169.254.169.254/latest'),
    ).rejects.toThrow('Private or special-purpose');
  });

  it('renders sourced findings and unavailable performance data', () => {
    const lead = {
      id: 'lead-1',
      companyName: 'Example',
      websiteUrl: 'https://example.com',
      stage: 'ANALYZED',
      twentyCompanyId: null,
      research: {
        profile: { description: 'Public description' },
        contacts: [
          {
            type: 'general_email',
            value: 'info@example.com',
            verificationStatus: 'verified_public',
          },
        ],
        technicalAudit: { usesHttps: true, detectedTechnologies: ['Next.js'] },
        opportunities: [
          {
            title: 'Performance',
            relevance: 'MEDIUM',
            evidence: 'Public signal',
            impact: 'Potential friction',
            solution: 'Audit',
            confidence: 'medium',
          },
        ],
        outreach: {
          recommendedChannel: 'email',
          primaryOffer: 'Audit',
          angle: 'Public signal',
          conversationOpener: 'Hello',
          subject: 'Observation',
          body: 'Body',
        },
        sourceUrls: ['https://example.com'],
        researchedAt: new Date('2026-10-24T07:00:00Z'),
      },
    } as unknown as Parameters<typeof renderLeadIntelligence>[0];
    const report = renderLeadIntelligence(lead).join('\n');
    expect(report).toContain('info@example.com');
    expect(report).toContain('Performance: bez PageSpeed měření');
    expect(report).toContain('https://example.com');
  });
});
