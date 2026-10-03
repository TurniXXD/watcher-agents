export const supportedLanguages = ['cs', 'en', 'de', 'sk', 'pl'] as const;

export type SupportedLanguage = (typeof supportedLanguages)[number];

export type CountryDetectionSource =
  | 'company_address'
  | 'company_registration'
  | 'discovery_metadata'
  | 'phone_country_code'
  | 'domain_tld';

export type LanguageDetectionSource =
  | 'html_lang'
  | 'website_default_language'
  | 'website_content'
  | 'discovery_metadata';

export type CountryDetection = {
  code: string;
  name: string;
  confidence: number;
  source: CountryDetectionSource;
  reason: string;
};

export type LanguageDetection = {
  primary: SupportedLanguage;
  detected: SupportedLanguage[];
  confidence: number;
  source: LanguageDetectionSource;
  reason: string;
};

export type OutreachLanguageSelection = {
  language: SupportedLanguage;
  reason:
    | 'primary_website_language'
    | 'czech_entity_fallback'
    | 'foreign_entity_fallback';
  confidence: number;
};

export type EntityClassificationInput = {
  address?: string;
  registrationCountryCode?: string;
  discoveryCountryCode?: string;
  phone?: string;
  websiteUrl?: string;
  htmlLanguage?: string;
  discoveryLanguage?: string;
  alternateLanguages?: string[];
  websiteText?: string;
};
