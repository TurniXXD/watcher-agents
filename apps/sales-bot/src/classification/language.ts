import type {
  EntityClassificationInput,
  LanguageDetection,
  SupportedLanguage,
} from './types.js';
import { supportedLanguages } from './types.js';

const languageAliases: Record<string, SupportedLanguage> = {
  cs: 'cs',
  cz: 'cs',
  ces: 'cs',
  cze: 'cs',
  en: 'en',
  eng: 'en',
  de: 'de',
  deu: 'de',
  ger: 'de',
  sk: 'sk',
  slk: 'sk',
  slo: 'sk',
  pl: 'pl',
  pol: 'pl',
};

const markers: Record<SupportedLanguage, readonly string[]> = {
  cs: [
    ' a ',
    ' je ',
    ' pro ',
    ' na ',
    ' naše ',
    ' služby ',
    ' kontakt ',
    ' více ',
    ' jsme ',
  ],
  en: [
    ' and ',
    ' the ',
    ' for ',
    ' our ',
    ' services ',
    ' contact ',
    ' about ',
    ' we ',
  ],
  de: [' und ', ' der ', ' die ', ' für ', ' unsere ', ' kontakt ', ' wir '],
  sk: [' a ', ' je ', ' pre ', ' naše ', ' služby ', ' kontakt ', ' sme '],
  pl: [
    ' i ',
    ' jest ',
    ' dla ',
    ' nasze ',
    ' usługi ',
    ' kontakt ',
    ' jesteśmy ',
  ],
};

export const normalizeLanguageCode = (
  value: string | undefined,
): SupportedLanguage | undefined => {
  const code = value?.trim().toLowerCase().split(/[-_]/u)[0];
  return code ? languageAliases[code] : undefined;
};

const textScores = (text: string): Map<SupportedLanguage, number> => {
  const words = text.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  return new Map(
    supportedLanguages.map((language) => [
      language,
      words.filter((word) =>
        markers[language].some((marker) => marker.trim() === word),
      ).length,
    ]),
  );
};

export const detectLanguage = (
  input: EntityClassificationInput,
): LanguageDetection | undefined => {
  const htmlLanguage = normalizeLanguageCode(input.htmlLanguage);
  const alternateLanguages = [
    ...new Set(
      (input.alternateLanguages ?? [])
        .map(normalizeLanguageCode)
        .filter((value): value is SupportedLanguage => Boolean(value)),
    ),
  ];
  if (htmlLanguage) {
    return {
      primary: htmlLanguage,
      detected: [
        htmlLanguage,
        ...alternateLanguages.filter((value) => value !== htmlLanguage),
      ],
      confidence: 0.97,
      source:
        alternateLanguages.length > 0
          ? 'website_default_language'
          : 'html_lang',
      reason: 'The default website HTML language is explicit',
    };
  }

  const discoveryLanguage = normalizeLanguageCode(input.discoveryLanguage);
  if (discoveryLanguage) {
    return {
      primary: discoveryLanguage,
      detected: [
        discoveryLanguage,
        ...alternateLanguages.filter((value) => value !== discoveryLanguage),
      ],
      confidence: 0.9,
      source: 'discovery_metadata',
      reason: 'Primary language supplied as structured discovery metadata',
    };
  }

  const text = input.websiteText?.trim();
  if (!text || text.length < 80) {
    return undefined;
  }
  const ranked = [...textScores(text)].sort(
    (left, right) => right[1] - left[1],
  );
  const [best, second] = ranked;
  if (!best || best[1] < 3) {
    return undefined;
  }
  const margin = best[1] - (second?.[1] ?? 0);
  const confidence = Math.min(0.93, 0.65 + margin / Math.max(12, best[1] * 2));
  const detected = ranked
    .filter(([, score]) => score >= Math.max(2, best[1] * 0.35))
    .map(([language]) => language);
  return {
    primary: best[0],
    detected,
    confidence,
    source: 'website_content',
    reason: 'Dominant language markers in meaningful website text',
  };
};
