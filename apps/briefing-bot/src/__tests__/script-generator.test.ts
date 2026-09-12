import type { StructuredGeneration, StructuredJsonSchema } from '@watcher/llm';
import type { ZodType } from 'zod';
import type { BriefingStoryCluster } from '../story-types.js';
import {
  planBriefingDuration,
  selectStoriesForBudget,
} from '../briefing-duration.js';
import {
  BriefingScriptGenerator,
  fallbackBriefingScript,
  type ScriptGenerationInput,
} from '../script-generator.js';
import { normalizeForSpeech } from '../utils/tts-normalization.js';
import { describe, expect, it } from 'vitest';

const story = (
  id: string,
  score: number,
  watcherBot: 'stocks' | 'medical' = 'stocks',
): BriefingStoryCluster => ({
  id,
  eventIds: [id],
  events: [],
  title: `${id} title`,
  summary: `${id} summary`,
  status: 'NEW',
  importance: score,
  novelty: score,
  relevance: score,
  urgency: score,
  actionable: true,
  actionItems: [`Review ${id}`],
  watcherBots: [watcherBot],
  entities: [{ type: 'company', name: 'Merck', ticker: 'MRK' }],
  sourceUrls: [],
  perspectives: [
    {
      watcherBot,
      category: watcherBot === 'stocks' ? 'STOCK_CATALYST' : 'MEDICAL_TRIAL',
      summary: `${id} perspective`,
      confidence: 'HIGH',
    },
  ],
  firstEventAt: '2026-09-06T05:00:00.000Z',
  lastEventAt: '2026-09-06T05:00:00.000Z',
  score,
  previouslyMentioned: false,
});

const input = (stories: BriefingStoryCluster[]): ScriptGenerationInput => ({
  date: 'Sunday, September sixth',
  localTime: '07:00',
  dayPeriod: 'morning',
  timezone: 'Europe/Prague',
  location: 'Brno',
  weather: { status: 'AVAILABLE', spokenSummary: 'It is mild in Brno.' },
  calendar: {
    status: 'AVAILABLE',
    day: 'today',
    events: [],
    spokenSummary: 'Your calendar is clear today.',
  },
  stories,
  targetDurationMinutes: 7,
  maximumDurationMinutes: 15,
  wordBudget: 1_000,
  maximumWords: 2_175,
});

describe('briefing duration planning', () => {
  it('stays short on quiet days and expands only for important content', () => {
    const quiet = planBriefingDuration({
      stories: [],
      targetMinutes: 7,
      maximumMinutes: 15,
      voice: 'hfc_male',
      weatherAvailable: true,
      calendarEventCount: 0,
    });
    const busy = planBriefingDuration({
      stories: Array.from({ length: 10 }, (_, index) =>
        story(`major-${index}`, 92, index % 2 ? 'medical' : 'stocks'),
      ),
      targetMinutes: 7,
      maximumMinutes: 15,
      voice: 'hfc_male',
      weatherAvailable: true,
      calendarEventCount: 3,
    });

    expect(quiet.plannedMinutes).toBe(3);
    expect(quiet.wordsPerMinute).toBe(145);
    expect(busy.plannedMinutes).toBeGreaterThan(10);
    expect(busy.plannedMinutes).toBeLessThanOrEqual(15);
    expect(
      selectStoriesForBudget([story('a', 90), story('b', 80)], 410),
    ).toHaveLength(1);
  });
});

describe('BriefingScriptGenerator', () => {
  it('assembles validated spoken sections in the required order', async () => {
    let prompt = '';
    const model = {
      async generateStructuredWithMetrics<T>(
        value: string,
        _format: StructuredJsonSchema,
        schema: ZodType<T>,
      ): Promise<StructuredGeneration<T>> {
        prompt = value;
        return {
          result: schema.parse({
            greeting: 'Good morning.',
            weather: 'It is mild in Brno.',
            calendar: 'Your calendar is clear today.',
            newsPreview: 'I found one development worth mentioning.',
            topStories: ['Merck reported positive Phase III results.'],
            watchToday: ['Review MRK after the open.'],
            outro: 'That is your briefing.',
          }),
          metrics: { llmCallCount: 1, estimatedCostUsd: 0 },
        };
      },
    };
    const generator = new BriefingScriptGenerator(model);

    const result = await generator.generate(input([story('merck', 90)]));

    expect(result.displayScript.indexOf('It is mild')).toBeLessThan(
      result.displayScript.indexOf('calendar is clear'),
    );
    expect(result.displayScript.indexOf('worth mentioning')).toBeLessThan(
      result.displayScript.indexOf('Phase III'),
    );
    expect(result.ttsScript).toContain('Merck reported positive Phase three');
    expect(result.ttsScript).toContain('Review Merck after the open');
    expect(result.ttsSegments).toEqual([
      { text: result.ttsScript.replace(/\s+/g, ' ').trim(), language: 'en' },
    ]);
    expect(prompt).toContain('do not independently research or invent facts');
    expect(prompt).toContain('morning intelligence briefing at 07:00');
    expect(prompt).not.toContain('https://');
  });

  it('marks Czech calendar narration for the Czech Piper voice', async () => {
    const calendarInput = input([]);
    calendarInput.calendar = {
      status: 'AVAILABLE',
      day: 'today',
      events: [
        {
          id: 'calendar-1',
          title: 'Porada s Honzou',
          start: '2026-09-06T10:00:00+02:00',
          end: '2026-09-06T10:30:00+02:00',
          allDay: false,
        },
        {
          id: 'calendar-2',
          title: 'Product sync',
          start: '2026-09-06T12:00:00+02:00',
          end: '2026-09-06T12:30:00+02:00',
          allDay: false,
        },
      ],
      spokenSummary: 'Dnes máte poradu s Honzou v deset hodin.',
    };
    const model = {
      async generateStructuredWithMetrics<T>(
        _value: string,
        _format: StructuredJsonSchema,
        schema: ZodType<T>,
      ): Promise<StructuredGeneration<T>> {
        return {
          result: schema.parse({
            greeting: 'Good morning.',
            weather: 'It is mild in Brno.',
            calendar:
              'You have two events today. Porada s Honzou začíná v deset hodin. Product sync starts at noon.',
            newsPreview: 'There are no new developments.',
            topStories: [],
            watchToday: [],
            outro: 'That is your briefing.',
          }),
          metrics: { llmCallCount: 1, estimatedCostUsd: 0 },
        };
      },
    };

    const result = await new BriefingScriptGenerator(model).generate(
      calendarInput,
    );

    expect(result.ttsSegments.map(({ language }) => language)).toEqual([
      'en',
      'cs',
      'en',
    ]);
    expect(result.ttsSegments[1]?.text).toContain('Porada s Honzou');
    expect(result.ttsSegments[0]?.text).toContain('two events today');
    expect(result.ttsSegments[2]?.text).toContain('Product sync starts');
  });

  it('provides an honest deterministic fallback for degraded context', () => {
    const degraded = input([]);
    degraded.weather = { status: 'UNAVAILABLE' };
    degraded.calendar = { status: 'UNAVAILABLE', day: 'today', events: [] };

    const result = fallbackBriefingScript(degraded);

    expect(result.displayScript).toContain("couldn't retrieve the weather");
    expect(result.displayScript).toContain("couldn't retrieve your calendar");
    expect(result.displayScript).not.toContain('calendar is clear');
    expect(result.displayScript).toContain(
      'no new subscribed watcher developments',
    );
  });

  it('enforces a time-appropriate greeting and closing in generated audio', async () => {
    const evening = input([]);
    evening.localTime = '20:00';
    evening.dayPeriod = 'evening';
    evening.calendar = {
      status: 'AVAILABLE',
      day: 'tomorrow',
      events: [],
      spokenSummary: 'Your calendar is clear tomorrow.',
    };
    let prompt = '';
    const model = {
      async generateStructuredWithMetrics<T>(
        value: string,
        _format: StructuredJsonSchema,
        schema: ZodType<T>,
      ): Promise<StructuredGeneration<T>> {
        prompt = value;
        return {
          result: schema.parse({
            greeting: 'Good morning.',
            weather: null,
            calendar: 'Your calendar is clear tomorrow.',
            newsPreview: 'There are no new developments.',
            topStories: [],
            watchToday: [],
            outro: 'That is your morning briefing.',
          }),
          metrics: { llmCallCount: 1, estimatedCostUsd: 0 },
        };
      },
    };

    const result = await new BriefingScriptGenerator(model).generate(evening);

    expect(result.displayScript).toContain('Good evening.');
    expect(result.displayScript).toContain('your evening briefing');
    expect(result.displayScript).not.toContain('morning');
    expect(result.displayScript).toContain('Today in review.');
    expect(result.displayScript).toContain(
      'Tomorrow. Your calendar is clear tomorrow.',
    );
    expect(result.displayScript.indexOf('Today in review.')).toBeLessThan(
      result.displayScript.indexOf('Tomorrow.'),
    );
    expect(prompt).toContain('Summarize what happened today');
    expect(prompt).toContain(
      'The supplied weather forecast and Calendar window are for tomorrow',
    );
  });

  it('marks Czech story titles for the Czech Piper voice outside Calendar', () => {
    const czechStory = story('mu-clubs', 80);
    czechStory.title = 'Nábor 2026 - přihlašovací formulář';
    czechStory.summary = 'Student registration announcement.';
    const result = fallbackBriefingScript(input([czechStory]));

    expect(result.ttsSegments.some(({ language }) => language === 'cs')).toBe(
      true,
    );
    expect(
      result.ttsSegments.find(({ language }) => language === 'cs')?.text,
    ).toContain('Nábor 2026');
  });
});

describe('TTS normalization', () => {
  it('keeps display semantics while making finance and medical text speakable', () => {
    const display =
      'MRK rose +12.6% on $1.2B of Phase III data in Q2, covering 2028–29. CRISPR remains relevant.';
    const spoken = normalizeForSpeech(display, {
      entities: [{ type: 'company', name: 'Merck', ticker: 'MRK' }],
    });

    expect(spoken).toBe(
      'Merck rose up twelve point six percent on one point two billion dollars of Phase three data in second quarter, covering twenty twenty-eight to twenty twenty-nine. crisper remains relevant.',
    );
    expect(display).toContain('$1.2B');
  });
});
