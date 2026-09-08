import { eventCategories, type EventCategory } from './types.js';
import { normalizeText } from './normalization.js';

const rules: Array<[EventCategory, RegExp]> = [
  ['biology', /biology|biologi|genetic|genetik|genom|mykolog|fung|crispr/iu],
  ['medicine', /medicine|medical|medicin|health|zdravi|clinical|klinick/iu],
  ['biotech', /biotech|bioengineering|synthetic biology|bioinformat/iu],
  ['ai', /artificial intelligence|machine learning|deep learning|\bai\b|llm/iu],
  [
    'programming',
    /programming|developer|vyvoj|javascript|typescript|python|java\b|rust\b/iu,
  ],
  ['software', /software|cloud|devops|cyber|ux\b|web\b/iu],
  ['hardware', /hardware|semiconductor|electronics|elektroni/iu],
  ['iot', /internet of things|\biot\b|embedded/iu],
  ['maker', /maker|3d print|fab ?lab|diln/iu],
  ['engineering', /engineering|inzenyr|technolog/iu],
  ['startup', /startup|founder|venture capital|scaleup/iu],
  ['entrepreneurship', /entrepreneur|podnikan|business model/iu],
  ['investing', /invest|finance|financ|capital market/iu],
  ['lecture', /lecture|prednask|seminar|talk\b/iu],
  ['workshop', /workshop|dilna|hands-on/iu],
  ['hackathon', /hackathon|datathon|makeathon/iu],
  ['networking', /networking|meetup|setkani|community/iu],
  ['conference', /conference|konferenc|symposium|sympoz/iu],
  ['music', /concert|koncert|music|hudeb/iu],
  ['film', /film|cinema|kino/iu],
  ['art', /gallery|galerie|exhibition|vystav|umeni/iu],
  ['food', /food|gastronom|degust|jidlo/iu],
  ['outdoors', /outdoor|hike|turisti|excursion|exkurze/iu],
  ['volunteering', /volunteer|dobrovol/iu],
];

export const inferCategories = (
  value: string,
  defaults: readonly EventCategory[] = [],
): EventCategory[] => {
  const normalized = normalizeText(value);
  const matches = rules
    .filter(([, pattern]) => pattern.test(normalized))
    .map(([category]) => category);
  const categories = [...new Set([...defaults, ...matches])].filter((value) =>
    eventCategories.includes(value),
  );
  return categories.length > 0 ? categories : ['other'];
};
