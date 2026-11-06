/**
 * Conservative, explainable free-food classification. Free admission and free
 * food are independent: a free event says nothing about food, and a generic
 * mention of "refreshments" or "občerstvení zajištěno" is not proof that food
 * is free. Contradictory statements resolve to `unknown`.
 */
export type FreeFood = 'yes' | 'no' | 'unknown';

export type FoodEvidence = { text: string; sourceUrl?: string };

export type FreeFoodClassification = {
  freeFood: FreeFood;
  foodDetails: string | null;
  evidence: FoodEvidence[];
};

export type FreeFoodInput = {
  title: string;
  description?: string | null;
  priceText?: string | null;
  /** Free admission; only used to interpret "food included in admission". */
  isFree?: boolean | null;
  sourceUrl?: string;
};

// Patterns run on lowercase, diacritics-free text.
const FOOD_EN = String.raw`(?:food|pizzas?|lunch(?:es)?|breakfasts?|brunch|dinners?|snacks?|refreshments?|drinks?|beers?|coffee|catering|buffets?|meals?|sandwich(?:es)?|burgers?|cake|barbecue|bbq)`;
const FOOD_CS = String.raw`(?:obcerstveni|jidlo|jidla|pizza|pizzu|pizzy|obed|snidane|snidani|vecere|veceri|raut|pohosteni|svacina|svacinu|kava|kavu|pivo|catering|bufet|grilovacka)`;

const POSITIVE: RegExp[] = [
  new RegExp(
    String.raw`\b(?:free|complimentary)\s+(?:\w+\s+){0,2}${FOOD_EN}\b`,
    'u',
  ),
  new RegExp(
    String.raw`\b${FOOD_EN}\s+(?:and\s+\w+\s+)?(?:(?:is|are|will\s+be)\s+)?(?:provided|served|offered|available)\s+(?:for\s+free|free(?:\s+of\s+charge)?|at\s+no\s+(?:extra\s+)?(?:cost|charge))\b`,
    'u',
  ),
  new RegExp(
    String.raw`\b${FOOD_EN}\s+(?:is|are|will\s+be)\s+(?:on\s+us|free|complimentary)\b`,
    'u',
  ),
  new RegExp(
    String.raw`\b${FOOD_CS}\s+(?:a\s+\w+\s+)?(?:(?:je|bude|budou)\s+)?(?:\w+\s+)?zdarma\b`,
    'u',
  ),
  new RegExp(String.raw`\bzdarma\s+(?:\w+\s+){0,2}${FOOD_CS}\b`, 'u'),
  new RegExp(String.raw`\b(?:bezplatn\w*|neplacen\w*)\s+${FOOD_CS}\b`, 'u'),
];

/** Food included in the admission price: free food only when admission is free. */
const INCLUDED_IN_ADMISSION: RegExp[] = [
  new RegExp(
    String.raw`\b${FOOD_CS}\s+(?:je\s+)?v\s+cene\s+(?:vstup\w*|listk\w*|vstupenk\w*|registrac\w*)`,
    'u',
  ),
  new RegExp(
    String.raw`\b${FOOD_EN}\s+(?:is\s+|are\s+)?included\s+in\s+(?:the\s+)?(?:ticket|admission|entry|registration|price)`,
    'u',
  ),
];

const NEGATIVE: RegExp[] = [
  new RegExp(String.raw`\bno\s+(?:free\s+)?${FOOD_EN}\b`, 'u'),
  new RegExp(
    String.raw`\b${FOOD_EN}\s+(?:is\s+|are\s+|will\s+)?not\s+(?:be\s+)?(?:provided|included|free|served)\b`,
    'u',
  ),
  new RegExp(
    String.raw`\b${FOOD_EN}\s+(?:and\s+\w+\s+)?(?:will\s+be\s+|is\s+|are\s+)?(?:available\s+)?(?:for\s+purchase|to\s+buy|for\s+sale|at\s+(?:your\s+)?own\s+(?:cost|expense))\b`,
    'u',
  ),
  new RegExp(String.raw`\b(?:bring|pack)\s+your\s+own\s+${FOOD_EN}\b`, 'u'),
  new RegExp(String.raw`\bpaid\s+${FOOD_EN}\b`, 'u'),
  new RegExp(
    String.raw`\b${FOOD_CS}\s+(?:neni|nebude|nejsou)\s+(?:\w+\s+)?(?:zajisten\w*|v\s+cene|zdarma|k\s+dispozici)\b`,
    'u',
  ),
  new RegExp(
    String.raw`\b${FOOD_CS}\s+(?:si\s+)?(?:hradi|plati|hradite|platite)\b`,
    'u',
  ),
  new RegExp(
    String.raw`\b${FOOD_CS}\s+(?:za\s+poplatek|na\s+vlastni\s+naklady|za\s+vlastni\s+penize)\b`,
    'u',
  ),
  new RegExp(
    String.raw`\b${FOOD_CS}\s+(?:bude\s+)?(?:k|ke)\s+(?:zakoupeni|koupi|prodeji)\b`,
    'u',
  ),
  new RegExp(
    String.raw`\b(?:moznost\s+)?(?:zakoupeni|prodej)\s+${FOOD_CS}\b`,
    'u',
  ),
  new RegExp(String.raw`\b(?:vlastni|sve)\s+${FOOD_CS}\b`, 'u'),
];

const normalize = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ');

const sentences = (value: string): string[] =>
  value
    .split(/(?<=[.!?])\s+|\n+|\s+[•·|]\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

const snippet = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;

const capitalize = (value: string): string =>
  value.charAt(0).toUpperCase() + value.slice(1);

export const classifyFreeFood = (
  input: FreeFoodInput,
): FreeFoodClassification => {
  const text = [
    input.title,
    input.description ?? '',
    input.priceText ?? '',
  ].join('\n');
  const positives: Array<{ sentence: string; phrase: string }> = [];
  const negatives: Array<{ sentence: string; phrase: string }> = [];
  for (const sentence of sentences(text)) {
    const normalized = normalize(sentence);
    const negative = NEGATIVE.map((pattern) => pattern.exec(normalized)).find(
      Boolean,
    );
    if (negative) {
      negatives.push({ sentence, phrase: negative[0] });
      continue;
    }
    const positive = POSITIVE.map((pattern) => pattern.exec(normalized)).find(
      Boolean,
    );
    if (positive) {
      positives.push({ sentence, phrase: positive[0] });
      continue;
    }
    const included = INCLUDED_IN_ADMISSION.map((pattern) =>
      pattern.exec(normalized),
    ).find(Boolean);
    if (included) {
      if (input.isFree === true)
        positives.push({ sentence, phrase: included[0] });
      else if (input.isFree === false)
        negatives.push({ sentence, phrase: `${included[0]} (paid admission)` });
    }
  }
  const evidence = (items: Array<{ sentence: string }>): FoodEvidence[] =>
    items.slice(0, 5).map(({ sentence }) => ({
      text: snippet(sentence, 300),
      ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    }));
  if (positives.length > 0 && negatives.length === 0) {
    return {
      freeFood: 'yes',
      foodDetails: snippet(capitalize(positives[0]!.phrase), 120),
      evidence: evidence(positives),
    };
  }
  if (negatives.length > 0 && positives.length === 0) {
    return {
      freeFood: 'no',
      foodDetails: snippet(capitalize(negatives[0]!.phrase), 120),
      evidence: evidence(negatives),
    };
  }
  return {
    freeFood: 'unknown',
    foodDetails: null,
    evidence: evidence([...positives, ...negatives]),
  };
};
