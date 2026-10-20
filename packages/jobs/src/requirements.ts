import { extractTechnologyStack, normalizeText } from './normalization.js';

export type ExtractedJobRequirement = {
  category: 'EDUCATION' | 'LANGUAGE' | 'EXPERIENCE' | 'TECHNOLOGY' | 'LOCATION';
  importance: 'MANDATORY' | 'PREFERRED' | 'UNCERTAIN';
  text: string;
  normalized: string;
  evidence: string;
};

const importanceFor = (
  sentence: string,
): ExtractedJobRequirement['importance'] => {
  if (/preferred|advantage|nice to have|plus|bonus|optional/iu.test(sentence))
    return 'PREFERRED';
  if (
    /required|must|mandatory|need(?:ed)?|minimum|fluent|proficien|you have|we expect/iu.test(
      sentence,
    ) &&
    !/or equivalent|equivalent (?:professional |practical )?experience/iu.test(
      sentence,
    )
  )
    return 'MANDATORY';
  return 'UNCERTAIN';
};

const categoryFor = (
  sentence: string,
): ExtractedJobRequirement['category'] | undefined => {
  if (
    /\b(?:bachelor|master|phd|university|degree|diploma|education)\b/iu.test(
      sentence,
    )
  )
    return 'EDUCATION';
  if (
    /\b(?:english|german|deutsch|french|fran[cç]ais|language)\b/iu.test(
      sentence,
    )
  )
    return 'LANGUAGE';
  if (
    /\b\d{1,2}\+?\s*(?:years?|yrs?)\b|professional experience/iu.test(sentence)
  )
    return 'EXPERIENCE';
  if (
    /\b(?:remote|hybrid|onsite|on-site|work authorization|right to work|relocat|location)\b/iu.test(
      sentence,
    )
  )
    return 'LOCATION';
  if (extractTechnologyStack(sentence).length > 0) return 'TECHNOLOGY';
  return undefined;
};

export const extractJobRequirements = (
  description: string,
): ExtractedJobRequirement[] => {
  const unique = new Map<string, ExtractedJobRequirement>();
  for (const raw of description.split(/(?<=[.!?])\s+|[\r\n]+/u)) {
    const sentence = raw.replace(/\s+/gu, ' ').trim();
    if (sentence.length < 4) continue;
    const category = categoryFor(sentence);
    if (!category) continue;
    const normalized = normalizeText(sentence);
    const key = `${category}:${normalized}`;
    unique.set(key, {
      category,
      importance: importanceFor(sentence),
      text: sentence.slice(0, 2_000),
      normalized,
      evidence: sentence.slice(0, 2_000),
    });
  }
  return [...unique.values()];
};
