export type EligibilityInput = {
  stage: string;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  email: string | null;
  emailSyntaxValid: boolean;
  domain: string | null;
  draftSubject: string | null;
  draftBody: string | null;
  finalScore: number | null;
  campaign: {
    enabled: boolean;
    pausedReason: string | null;
    quicklyCampaignId: number | null;
    minimumLeadScore: number;
  };
  authorization: {
    basis: string;
    evidenceSource: string;
    evidenceReference: string;
    capturedAt: Date;
    expiresAt: Date | null;
    revokedAt: Date | null;
  } | null;
  suppressed: boolean;
};

export const sendEligibility = (
  input: EligibilityInput,
  now = new Date(),
): { eligible: boolean; reasons: string[] } => {
  const reasons: string[] = [];
  if (input.stage !== 'QUALIFIED') reasons.push('lead_not_qualified');
  if (!input.approvedAt || input.rejectedAt)
    reasons.push('operator_approval_missing');
  if (!input.email || !input.emailSyntaxValid)
    reasons.push('valid_email_missing');
  if (!input.draftSubject || !input.draftBody) reasons.push('draft_missing');
  if (
    input.finalScore === null ||
    input.finalScore < input.campaign.minimumLeadScore
  )
    reasons.push('score_below_threshold');
  if (!input.campaign.enabled || input.campaign.pausedReason)
    reasons.push('campaign_disabled');
  if (!input.campaign.quicklyCampaignId)
    reasons.push('quickly_campaign_missing');
  if (input.suppressed) reasons.push('suppressed');
  const auth = input.authorization;
  if (
    !auth ||
    !['RECIPIENT_OPT_IN', 'EXISTING_CUSTOMER'].includes(auth.basis) ||
    !auth.evidenceSource.trim() ||
    !auth.evidenceReference.trim() ||
    auth.capturedAt > now ||
    auth.revokedAt !== null ||
    (auth.expiresAt !== null && auth.expiresAt <= now)
  )
    reasons.push('legal_basis_not_evidenced');
  return { eligible: reasons.length === 0, reasons };
};
