import { detectLanguage } from '../../classification/index.js';
import type { ColdEmailContext, ColdEmailOutput } from './types.js';

const forbiddenPhrases = [
  'i hope this email finds you well',
  "i'd love to connect",
  'i was impressed by',
  "i love what you're doing",
  'revolutionize',
  'unlock',
  'elevate',
  'cutting-edge',
  'game-changing',
  'synergy',
  'doufám, že vás tento e-mail zastihne',
  'rád bych se spojil',
  'udělalo na mě dojem',
  'revoluční',
  'odemknout potenciál',
  'synergie',
] as const;

const normalizeFact = (value: string): string =>
  value.trim().replaceAll(/\s+/gu, ' ').toLocaleLowerCase('en');

const wordCount = (value: string): number =>
  value.trim() ? value.trim().split(/\s+/u).length : 0;

export const validateColdEmail = (
  context: ColdEmailContext,
  output: ColdEmailOutput,
): string[] => {
  const errors: string[] = [];
  if (output.language !== context.language) {
    errors.push(`language must equal requested language ${context.language}`);
  }
  if (!output.subject.trim()) errors.push('subject must not be empty');
  if (!output.body.trim()) errors.push('body must not be empty');
  if (wordCount(output.body) > 80)
    errors.push('body must contain at most 80 words');
  if (output.body.includes('!') || output.subject.includes('!')) {
    errors.push('subject and body must not contain exclamation marks');
  }
  const questionCount = (output.body.match(/\?/gu) ?? []).length;
  if (questionCount !== 1) {
    errors.push('body must contain exactly one CTA question');
  }
  const customerText = `${output.subject}\n${output.body}`.toLowerCase();
  const forbidden = forbiddenPhrases.find((phrase) =>
    customerText.includes(phrase),
  );
  if (forbidden) errors.push(`forbidden phrase: ${forbidden}`);

  const detected = detectLanguage({ websiteText: output.body });
  if (
    detected &&
    detected.confidence >= 0.7 &&
    detected.primary !== context.language
  ) {
    errors.push(
      `body language ${detected.primary} does not match ${context.language}`,
    );
  }

  if (output.insufficientPersonalizationData) {
    if (output.personalizationFact !== null) {
      errors.push('personalizationFact must be null when data is insufficient');
    }
  } else if (!output.personalizationFact) {
    errors.push('personalizationFact is required when data is sufficient');
  } else {
    const allowedFacts = new Set(context.research.facts.map(normalizeFact));
    if (!allowedFacts.has(normalizeFact(output.personalizationFact))) {
      errors.push('personalizationFact must exactly match a supplied fact');
    }
  }
  return errors;
};
