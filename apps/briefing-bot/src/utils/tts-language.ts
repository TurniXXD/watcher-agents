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
  'do',
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
  'nemecko',
  'norimberk',
  'obed',
  'od',
  'porada',
  'praha',
  'praze',
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
  'ukrajina',
  'urad',
  'vyzvednout',
  'zkouska',
]);

const normalizedWords = (value: string): string[] =>
  value
    .normalize('NFKD')
    .toLowerCase()
    .replaceAll(/\p{Mark}/gu, '')
    .match(/\p{Letter}+/gu) ?? [];

export const isLikelyCzech = (value: string): boolean => {
  if (czechCharacters.test(value)) return true;
  return normalizedWords(value).some((word) => czechWords.has(word));
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
  isLikelyCzech(sentence) ||
  czechEvents.some((event) => includesEventTitle(sentence, event));

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

const segmentByDetectedLanguage = (
  text: string,
  czechEvents: readonly CalendarEvent[],
): TtsSegment[] => {
  const segments: TtsSegment[] = [];
  for (const sentence of sentenceParts(text)) {
    appendSegment(
      segments,
      sentence,
      calendarSentenceIsCzech(sentence, czechEvents) ? 'cs' : 'en',
    );
  }
  return segments.length > 0 ? segments : [{ text, language: 'en' }];
};

export const segmentTtsScriptByCalendarLanguage = (
  fullScript: string,
  calendarScript: string | undefined,
  events: readonly CalendarEvent[],
): TtsSegment[] => {
  const czechEvents = events.filter(calendarEventIsCzech);
  if (!calendarScript)
    return segmentByDetectedLanguage(fullScript, czechEvents);
  const calendarOffset = fullScript.indexOf(calendarScript);
  if (calendarOffset < 0)
    return segmentByDetectedLanguage(fullScript, czechEvents);

  const segments: TtsSegment[] = [];
  for (const segment of segmentByDetectedLanguage(
    fullScript.slice(0, calendarOffset),
    czechEvents,
  )) {
    appendSegment(segments, segment.text, segment.language);
  }
  for (const sentence of sentenceParts(calendarScript)) {
    appendSegment(
      segments,
      sentence,
      calendarSentenceIsCzech(sentence, czechEvents) ? 'cs' : 'en',
    );
  }
  for (const segment of segmentByDetectedLanguage(
    fullScript.slice(calendarOffset + calendarScript.length),
    czechEvents,
  )) {
    appendSegment(segments, segment.text, segment.language);
  }
  return segments;
};
