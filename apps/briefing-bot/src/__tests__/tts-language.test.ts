import { describe, expect, it } from 'vitest';
import { segmentTtsScriptByCalendarLanguage } from '../utils/tts-language.js';

describe('briefing TTS language segments', () => {
  it('keeps an English sentence in the English voice when it names a Czech place', () => {
    expect(
      segmentTtsScriptByCalendarLanguage(
        'Microsoft reported results in Praha.',
        undefined,
        [],
      ),
    ).toEqual([
      { text: 'Microsoft reported results in Praha.', language: 'en' },
    ]);
  });

  it('does not mistake the English auxiliary do for a Czech word', () => {
    expect(
      segmentTtsScriptByCalendarLanguage(
        'Do review the report.',
        undefined,
        [],
      ),
    ).toEqual([{ text: 'Do review the report.', language: 'en' }]);
  });

  it('switches to the English voice for a known English title inside Czech narration', () => {
    expect(
      segmentTtsScriptByCalendarLanguage(
        'Dnes máte Product sync v poledne.',
        'Dnes máte Product sync v poledne.',
        [
          {
            id: 'event-1',
            title: 'Product sync',
            start: '2026-09-22T12:00:00+02:00',
            end: '2026-09-22T12:30:00+02:00',
            allDay: false,
          },
        ],
        ['Product sync'],
      ),
    ).toEqual([
      { text: 'Dnes máte', language: 'cs' },
      { text: 'Product sync', language: 'en' },
      { text: 'v poledne.', language: 'cs' },
    ]);
  });

  it('keeps English narration around a known Czech event title in English', () => {
    expect(
      segmentTtsScriptByCalendarLanguage(
        'Porada s Honzou starts at ten.',
        'Porada s Honzou starts at ten.',
        [
          {
            id: 'event-2',
            title: 'Porada s Honzou',
            start: '2026-09-22T10:00:00+02:00',
            end: '2026-09-22T10:30:00+02:00',
            allDay: false,
          },
        ],
      ),
    ).toEqual([
      { text: 'Porada s Honzou', language: 'cs' },
      { text: 'starts at ten.', language: 'en' },
    ]);
  });

  it('keeps the final punctuation with an English company name', () => {
    expect(
      segmentTtsScriptByCalendarLanguage(
        'Dnes se řeší Microsoft.',
        undefined,
        [],
        ['Microsoft'],
      ),
    ).toEqual([
      { text: 'Dnes se řeší', language: 'cs' },
      { text: 'Microsoft.', language: 'en' },
    ]);
  });
});
