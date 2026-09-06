import type { BriefingEntity } from '@watcher/core';

const smallNumbers = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
] as const;
const tens = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
] as const;

const integerWords = (value: number): string => {
  if (value < 20) return smallNumbers[value]!;
  if (value < 100) {
    return `${tens[Math.floor(value / 10)]}${value % 10 ? `-${smallNumbers[value % 10]}` : ''}`;
  }
  if (value < 1_000) {
    return `${smallNumbers[Math.floor(value / 100)]} hundred${value % 100 ? ` ${integerWords(value % 100)}` : ''}`;
  }
  if (value < 1_000_000) {
    return `${integerWords(Math.floor(value / 1_000))} thousand${value % 1_000 ? ` ${integerWords(value % 1_000)}` : ''}`;
  }
  return String(value);
};

const numberWords = (value: string): string => {
  const [whole, decimal] = value.split('.');
  const integer = integerWords(Number(whole));
  return decimal
    ? `${integer} point ${[...decimal].map((digit) => smallNumbers[Number(digit)]).join(' ')}`
    : integer;
};

const yearWords = (value: string): string => {
  const year = Number(value);
  const first = Math.floor(year / 100);
  const second = year % 100;
  return `${integerWords(first)}${second ? ` ${integerWords(second)}` : ' hundred'}`;
};

const escaped = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export type SpeechNormalizationInput = {
  entities?: readonly BriefingEntity[];
  pronunciations?: Readonly<Record<string, string>>;
};

export const normalizeForSpeech = (
  displayScript: string,
  input: SpeechNormalizationInput = {},
): string => {
  let spoken = displayScript
    .replaceAll(/https?:\/\/\S+/g, '')
    .replaceAll(/[*_`#]/g, '')
    .replaceAll(
      /\b(20\d{2})[–-](\d{2}|20\d{2})\b/g,
      (_match: string, start: string, end: string) => {
        const fullEnd = end.length === 2 ? `20${end}` : end;
        return `${yearWords(start)} to ${yearWords(fullEnd)}`;
      },
    )
    .replaceAll(
      /\$(\d+(?:\.\d+)?)\s*([BMK])?\b/g,
      (_match: string, amount: string, scale: string | undefined) => {
        const scaleWord =
          scale === 'B'
            ? ' billion'
            : scale === 'M'
              ? ' million'
              : scale === 'K'
                ? ' thousand'
                : '';
        return `${numberWords(amount)}${scaleWord} dollars`;
      },
    )
    .replaceAll(
      /([+-])(\d+(?:\.\d+)?)%/g,
      (_match: string, direction: string, value: string) =>
        `${direction === '+' ? 'up' : 'down'} ${numberWords(value)} percent`,
    )
    .replaceAll(
      /\b(\d+(?:\.\d+)?)%/g,
      (_match: string, value: string) => `${numberWords(value)} percent`,
    )
    .replaceAll(
      /\bPhase\s+(IV|III|II|I)\b/gi,
      (_match: string, phase: string) => {
        const phases: Record<string, string> = {
          I: 'one',
          II: 'two',
          III: 'three',
          IV: 'four',
        };
        return `Phase ${phases[String(phase).toUpperCase()]}`;
      },
    )
    .replaceAll(/\bQ([1-4])\b/g, (_match, quarter) => {
      const quarters = ['first', 'second', 'third', 'fourth'];
      return `${quarters[Number(quarter) - 1]} quarter`;
    });

  const tickerNames = new Map(
    (input.entities ?? []).flatMap((entity) =>
      entity.ticker ? [[entity.ticker, entity.name] as const] : [],
    ),
  );
  [...tickerNames.entries()]
    .sort(([left], [right]) => right.length - left.length)
    .forEach(([ticker, name]) => {
      spoken = spoken.replaceAll(
        new RegExp(`\\b${escaped(ticker)}\\b`, 'g'),
        name,
      );
    });

  const pronunciations = { CRISPR: 'crisper', ...(input.pronunciations ?? {}) };
  Object.entries(pronunciations).forEach(([term, pronunciation]) => {
    spoken = spoken.replaceAll(
      new RegExp(`\\b${escaped(term)}\\b`, 'gi'),
      pronunciation,
    );
  });
  return spoken
    .replaceAll(/[ \t]+/g, ' ')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();
};
