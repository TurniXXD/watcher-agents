import { describe, expect, it } from 'vitest';
import { sendEligibility, type EligibilityInput } from '../eligibility.js';

const ready = (): EligibilityInput => ({
  stage: 'QUALIFIED',
  approvedAt: new Date('2026-09-01'),
  rejectedAt: null,
  email: 'buyer@example.com',
  emailSyntaxValid: true,
  domain: 'example.com',
  draftSubject: 'Hello',
  draftBody: 'Body',
  finalScore: 80,
  campaign: {
    enabled: true,
    pausedReason: null,
    quicklyCampaignId: 3,
    minimumLeadScore: 70,
  },
  authorization: {
    basis: 'RECIPIENT_OPT_IN',
    evidenceSource: 'signup-form',
    evidenceReference: 'submission-123',
    capturedAt: new Date('2026-09-01'),
    expiresAt: null,
    revokedAt: null,
  },
  suppressed: false,
});

describe('send eligibility', () => {
  it('permits only fully evidenced and approved leads', () => {
    expect(sendEligibility(ready()).eligible).toBe(true);
  });
  it('keeps unknown basis out of Quickly without rejecting the lead', () => {
    const lead = ready();
    lead.authorization = null;
    expect(sendEligibility(lead)).toEqual({
      eligible: false,
      reasons: ['legal_basis_not_evidenced'],
    });
    expect(lead.stage).toBe('QUALIFIED');
  });
  it('rejects expired, revoked, or suppressed evidence', () => {
    const lead = ready();
    lead.authorization!.revokedAt = new Date();
    expect(sendEligibility(lead).eligible).toBe(false);
    lead.authorization!.revokedAt = null;
    lead.authorization!.expiresAt = new Date('2026-01-01');
    expect(sendEligibility(lead).eligible).toBe(false);
    lead.authorization!.expiresAt = null;
    lead.suppressed = true;
    expect(sendEligibility(lead).reasons).toContain('suppressed');
  });
});
