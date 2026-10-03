export type TwentyRecord = { id: string } & Record<string, unknown>;

export type TwentyCompanyInput = {
  name: string;
  websiteUrl: string;
  domain: string;
  registrationId?: string;
  externalId?: string;
  countryCode?: string;
  primaryLanguage?: string;
  detectedLanguages?: string[];
  languageConfidence?: number;
  languageDetectionSource?: string;
  countryConfidence?: number;
  countryDetectionSource?: string;
  location?: string;
  industry?: string;
  source: string;
  sourceUrl?: string;
  leadScore?: number;
  icpScore?: number;
  lastResearchedAt: Date;
};

export type TwentyPersonInput = {
  firstName: string;
  lastName?: string;
  email?: string;
  companyId?: string;
  source: string;
  sourceUrl?: string;
  externalId?: string;
  preferredLanguage?: string;
  detectedLanguages?: string[];
  countryCode?: string;
};

export type TwentyOpportunityInput = {
  name: string;
  companyId: string;
  businessType:
    | 'WEB_DEVELOPMENT'
    | 'PROPERTY_MANAGEMENT'
    | 'OFFICE_CARE'
    | 'EQUIPMENT_RENTAL'
    | 'OTHER';
  source: string;
  nextAction?: string;
  qualification?: string;
};

export type TwentyDraftInput = {
  externalId: string;
  companyId?: string;
  personId?: string;
  subject: string;
  body: string;
  promptVersion: string;
  model: string;
  language: string;
  languageDetectionConfidence?: number;
  countryCode?: string;
  personalizationFact?: string;
  generationConfidence: number;
  createdAt: Date;
};

export type TwentyCurrencyValue = {
  amountMicros: number;
  currencyCode: string;
};

export type TwentyInteractionInput = {
  externalId: string;
  title: string;
  body: string;
  companyId?: string;
  personId?: string;
};
