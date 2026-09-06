import type { CalendarEvent } from '../calendar.js';
import type { TtsLanguage, TtsSegment } from '../tts.js';

const czechCharacters = /[áčďéěíňóřšťúůýž]/iu;
const czechWords = new Set([
  'bez',
  'bude',
  'budeme',
  'byl',
  'byla',
  'dnes',
  'do',
  'doktor',
  'dovolena',
  'jednani',
  'kontrola',
  'lekari',
  'navsteva',
  'narozeniny',
  'obed',
  'od',
  'porada',
  'pracovni',
  'pro',
  'schuzka',
  'skola',
  'skolka',
  'trenink',
  'tym',
  'tymem',
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

export const segmentTtsScriptByCalendarLanguage = (
  fullScript: string,
  calendarScript: string | undefined,
  events: readonly CalendarEvent[],
): TtsSegment[] => {
  if (!calendarScript) return [{ text: fullScript, language: 'en' }];
  const calendarOffset = fullScript.indexOf(calendarScript);
  if (calendarOffset < 0) return [{ text: fullScript, language: 'en' }];

  const czechEvents = events.filter(calendarEventIsCzech);
  if (czechEvents.length === 0) return [{ text: fullScript, language: 'en' }];

  const segments: TtsSegment[] = [];
  appendSegment(segments, fullScript.slice(0, calendarOffset), 'en');
  for (const sentence of sentenceParts(calendarScript)) {
    appendSegment(
      segments,
      sentence,
      isLikelyCzech(sentence) ||
        czechEvents.some((event) => includesEventTitle(sentence, event))
        ? 'cs'
        : 'en',
    );
  }
  appendSegment(
    segments,
    fullScript.slice(calendarOffset + calendarScript.length),
    'en',
  );
  return segments;
};
