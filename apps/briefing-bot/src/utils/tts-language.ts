import type { CalendarEvent } from '../calendar.js';
import type { TtsLanguage, TtsSegment } from '../tts.js';

const czechCharacters = /[áčďéěíňóřšťúůýž]/iu;
const czechWords = new Set([
  'akce',
  'archiv',
  'bez',
  'bude',
  'budeme',
  'byl',
  'byla',
  'cesko',
  'cesky',
  'konference',
  'dnes',
  'doktor',
  'dovolena',
  'formulare',
  'formular',
  'jednani',
  'kontrola',
  'lekari',
  'navsteva',
  'narozeniny',
  'nabor',
  'obed',
  'od',
  'porada',
  'prihlaska',
  'prihlasovaci',
  'pracovni',
  'pro',
  'sraz',
  'schuzka',
  'skola',
  'skolka',
  'turnaj',
  'turnaje',
  'trenink',
  'tym',
  'tymem',
  'urad',
  'vyzvednout',
  'zkouska',
]);
const englishWords = new Set([
  'after',
  'announced',
  'announces',
  'are',
  'at',
  'before',
  'for',
  'from',
  'has',
  'in',
  'is',
  'of',
  'on',
  'reported',
  'reports',
  'starts',
  'the',
  'today',
  'tomorrow',
  'was',
  'were',
  'with',
]);

const normalizedWords = (value: string): string[] =>
  value
    .normalize('NFKD')
    .toLowerCase()
    .replaceAll(/\p{Mark}/gu, '')
    .match(/\p{Letter}+/gu) ?? [];

const languageEvidence = (value: string) => {
  const words = normalizedWords(value);
  const czechHits = words.filter((word) => czechWords.has(word)).length;
  const englishHits = words.filter((word) => englishWords.has(word)).length;
  return { czechHits, englishHits };
};

const isClearlyEnglish = (value: string): boolean => {
  const { czechHits, englishHits } = languageEvidence(value);
  return englishHits >= 2 && englishHits > czechHits;
};

export const isLikelyCzech = (value: string): boolean => {
  if (isClearlyEnglish(value)) return false;
  return czechCharacters.test(value) || languageEvidence(value).czechHits > 0;
};

export const calendarEventIsCzech = (event: CalendarEvent): boolean =>
  isLikelyCzech(event.title);

const sentenceParts = (value: string): string[] =>
  value.match(/[^.!?]+(?:[.!?]+|$)/gu)?.map((part) => part.trim()) ?? [];

const includesEventTitle = (sentence: string, event: CalendarEvent): boolean =>
  sentence
    .toLocaleLowerCase('cs-CZ')
    .includes(event.title.toLocaleLowerCase('cs-CZ'));

const calendarSentenceIsCzech = (
  sentence: string,
  czechEvents: readonly CalendarEvent[],
): boolean =>
  !isClearlyEnglish(sentence) &&
  (isLikelyCzech(sentence) ||
    czechEvents.some((event) => includesEventTitle(sentence, event)));

const appendSegment = (
  segments: TtsSegment[],
  text: string,
  language: TtsLanguage,
): void => {
  const normalized = text.trim();
  if (!normalized) return;
  const previous = segments.at(-1);
  if (previous?.language === language) {
    previous.text = `${previous.text} ${normalized}`;
    return;
  }
  segments.push({ text: normalized, language });
};

const splitKnownPhrases = (
  sentence: string,
  phrases: readonly string[],
  baseLanguage: TtsLanguage,
  phraseLanguage: TtsLanguage,
): { text: string; language: TtsLanguage }[] => {
  const matches: { start: number; end: number }[] = [];
  const lower = sentence.toLocaleLowerCase('en-US');
  for (const phrase of phrases) {
    const needle = phrase.toLocaleLowerCase('en-US');
    let offset = 0;
    while (offset < lower.length) {
      const start = lower.indexOf(needle, offset);
      if (start < 0) break;
      const end = start + needle.length;
      const before = sentence[start - 1];
      const after = sentence[end];
      if (!(
        (before ?? '').match(/[\p{Letter}\p{Number}]/u) ||
        (after ?? '').match(/[\p{Letter}\p{Number}]/u)
      )) {
        matches.push({ start, end });
      }
      offset = end;
    }
  }
  matches.sort((left, right) =>
    left.start === right.start
      ? right.end - left.end
      : left.start - right.start,
  );
  const parts: { text: string; language: TtsLanguage }[] = [];
  let offset = 0;
  for (const match of matches) {
    if (match.start < offset) continue;
    if (match.start > offset)
      parts.push({
        text: sentence.slice(offset, match.start),
        language: baseLanguage,
      });
    let end = match.end;
    if (/^[.!?]+$/u.test(sentence.slice(end).trim())) end = sentence.length;
    parts.push({
      text: sentence.slice(match.start, end),
      language: phraseLanguage,
    });
    offset = end;
  }
  if (offset < sentence.length)
    parts.push({ text: sentence.slice(offset), language: baseLanguage });
  return parts;
};

const segmentByDetectedLanguage = (
  text: string,
  czechEvents: readonly CalendarEvent[],
  englishPhrases: readonly string[],
  czechPhrases: readonly string[],
): TtsSegment[] => {
  const segments: TtsSegment[] = [];
  for (const sentence of sentenceParts(text)) {
    const baseLanguage = calendarSentenceIsCzech(sentence, czechEvents)
      ? 'cs'
      : 'en';
    const phrases = baseLanguage === 'cs' ? englishPhrases : czechPhrases;
    const phraseLanguage = baseLanguage === 'cs' ? 'en' : 'cs';
    for (const part of splitKnownPhrases(
      sentence,
      phrases,
      baseLanguage,
      phraseLanguage,
    ))
      appendSegment(segments, part.text, part.language);
  }
  return segments.length > 0 ? segments : [{ text, language: 'en' }];
};

export const segmentTtsScriptByCalendarLanguage = (
  fullScript: string,
  calendarScript: string | undefined,
  events: readonly CalendarEvent[],
  englishPhrases: readonly string[] = [],
): TtsSegment[] => {
  const czechEvents = events.filter(calendarEventIsCzech);
  const phrases = [
    ...new Set(englishPhrases.filter((phrase) => phrase.length >= 2)),
  ]
    .filter((phrase) => !isLikelyCzech(phrase))
    .sort((left, right) => right.length - left.length);
  const czechPhrases = [
    ...new Set([
      ...englishPhrases.filter((phrase) => isLikelyCzech(phrase)),
      ...czechEvents.map(({ title }) => title),
    ]),
  ].sort((left, right) => right.length - left.length);
  if (!calendarScript)
    return segmentByDetectedLanguage(
      fullScript,
      czechEvents,
      phrases,
      czechPhrases,
    );
  const calendarOffset = fullScript.indexOf(calendarScript);
  if (calendarOffset < 0)
    return segmentByDetectedLanguage(
      fullScript,
      czechEvents,
      phrases,
      czechPhrases,
    );

  const segments: TtsSegment[] = [];
  for (const segment of segmentByDetectedLanguage(
    fullScript.slice(0, calendarOffset),
    czechEvents,
    phrases,
    czechPhrases,
  )) {
    appendSegment(segments, segment.text, segment.language);
  }
  for (const sentence of sentenceParts(calendarScript)) {
    const baseLanguage = calendarSentenceIsCzech(sentence, czechEvents)
      ? 'cs'
      : 'en';
    const knownPhrases = baseLanguage === 'cs' ? phrases : czechPhrases;
    const phraseLanguage = baseLanguage === 'cs' ? 'en' : 'cs';
    for (const part of splitKnownPhrases(
      sentence,
      knownPhrases,
      baseLanguage,
      phraseLanguage,
    ))
      appendSegment(segments, part.text, part.language);
  }
  for (const segment of segmentByDetectedLanguage(
    fullScript.slice(calendarOffset + calendarScript.length),
    czechEvents,
    phrases,
    czechPhrases,
  )) {
    appendSegment(segments, segment.text, segment.language);
  }
  return segments;
};
