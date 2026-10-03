import type { SupportedLanguage } from '../../classification/index.js';

export type ColdEmailContext = {
  language: SupportedLanguage;
  lead: {
    firstName: string;
    lastName?: string;
    position?: string;
  };
  company: {
    name: string;
    industry?: string;
    website?: string;
    location?: string;
    countryCode?: string;
  };
  research: {
    facts: string[];
    possibleProblems?: string[];
    relevantSignals?: string[];
  };
  offer: {
    service: string;
    capabilities: string[];
  };
};

export type ColdEmailOutput = {
  language: SupportedLanguage;
  subject: string;
  body: string;
  personalizationReason: string;
  personalizationFact: string | null;
  confidence: number;
  insufficientPersonalizationData: boolean;
};
