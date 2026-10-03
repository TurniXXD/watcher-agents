import type {
  CountryDetection,
  LanguageDetection,
  OutreachLanguageSelection,
} from './types.js';

export const selectOutreachLanguage = (input: {
  country?: CountryDetection;
  language?: LanguageDetection;
}): OutreachLanguageSelection => {
  if (input.language && input.language.confidence >= 0.7) {
    return {
      language: input.language.primary,
      reason: 'primary_website_language',
      confidence: input.language.confidence,
    };
  }
  if (input.country?.code === 'CZ') {
    return {
      language: 'cs',
      reason: 'czech_entity_fallback',
      confidence: Math.max(0.72, input.country.confidence * 0.85),
    };
  }
  return {
    language: 'en',
    reason: 'foreign_entity_fallback',
    confidence: input.country ? 0.65 : 0.5,
  };
};
