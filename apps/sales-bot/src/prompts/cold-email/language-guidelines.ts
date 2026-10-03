import type { SupportedLanguage } from '../../classification/index.js';

const guidelines: Record<SupportedLanguage, string> = {
  cs: `Write natural Czech business communication. Avoid literal translations from English, excessive corporate language, and unnecessary anglicisms. Use a Czech salutation only when the supplied name supports it; never invent titles.`,
  en: `Write concise, natural international B2B English. Avoid stereotypical American sales hype.`,
  de: `Write concise, natural German business communication. Do not translate English sales idioms literally.`,
  sk: `Write concise, natural Slovak business communication. Avoid Czech/English mixing except proper nouns.`,
  pl: `Write concise, natural Polish business communication. Avoid English sales idioms and unnecessary corporate language.`,
};

export const coldEmailLanguageGuidance = (
  language: SupportedLanguage,
): string => guidelines[language];
