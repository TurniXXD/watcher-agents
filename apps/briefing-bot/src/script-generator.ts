import type { AnalysisMetrics, BriefingEntity } from '@watcher/core';
import type { StructuredGeneration, StructuredJsonSchema } from '@watcher/llm';
import { z } from 'zod';
import type { CalendarEvent } from './calendar.js';
import type { BriefingStoryCluster } from './story-types.js';
import type { TtsSegment } from './tts.js';
import {
  briefingDayPeriodPresentation,
  type BriefingDayPeriod,
  isEndOfDayBriefing,
} from './utils/day-period.js';
import { segmentTtsScriptByCalendarLanguage } from './utils/tts-language.js';
import { normalizeForSpeech } from './utils/tts-normalization.js';

const generatedSectionsSchema = z
  .object({
    greeting: z.string().trim().min(1).max(1_000),
    weather: z.string().trim().min(1).max(2_000).nullable(),
    calendar: z.string().trim().min(1).max(3_000).nullable(),
    newsPreview: z.string().trim().min(1).max(2_000),
    topStories: z.array(z.string().trim().min(1).max(5_000)).max(30),
    watchToday: z.array(z.string().trim().min(1).max(1_000)).max(3),
    outro: z.string().trim().min(1).max(500),
  })
  .strict();

const generatedSectionsJsonSchema: StructuredJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'greeting',
    'weather',
    'calendar',
    'newsPreview',
    'topStories',
    'watchToday',
    'outro',
  ],
  properties: {
    greeting: { type: 'string' },
    weather: { type: ['string', 'null'] },
    calendar: { type: ['string', 'null'] },
    newsPreview: { type: 'string' },
    topStories: { type: 'array', items: { type: 'string' } },
    watchToday: {
      type: 'array',
      maxItems: 3,
      items: { type: 'string' },
    },
    outro: { type: 'string' },
  },
};

type StructuredScriptModel = {
  generateStructuredWithMetrics<T>(
    prompt: string,
    format: StructuredJsonSchema,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
    generation?: { numPredict?: number },
  ): Promise<StructuredGeneration<T>>;
};

export type ContextAvailability = 'AVAILABLE' | 'UNAVAILABLE' | 'DISABLED';

export type ScriptGenerationInput = {
  date: string;
  localTime: string;
  dayPeriod: BriefingDayPeriod;
  timezone: string;
  location?: string;
  weather: { status: ContextAvailability; spokenSummary?: string };
  calendar: {
    status: ContextAvailability;
    day: 'today' | 'tomorrow';
    events: readonly CalendarEvent[];
    spokenSummary?: string;
    insights?: readonly string[];
  };
  stories: readonly BriefingStoryCluster[];
  targetDurationMinutes: number;
  maximumDurationMinutes: number;
  wordBudget: number;
  maximumWords: number;
  pronunciations?: Readonly<Record<string, string>>;
  actionAgenda?: readonly string[];
  dataQuality?: readonly string[];
};

export type GeneratedBriefingScript = {
  displayScript: string;
  ttsScript: string;
  ttsSegments: readonly TtsSegment[];
  wordCount: number;
  metrics: AnalysisMetrics;
};

const promptFor = (input: ScriptGenerationInput): string => {
  const stories = input.stories.map((story) => ({
    id: story.id,
    title: story.title,
    summary: story.summary,
    score: story.score,
    status: story.status,
    importance: story.importance,
    actionable: story.actionable,
    actionItems: story.actionItems,
    entities: story.entities,
    perspectives: story.perspectives,
    previouslyMentioned: story.previouslyMentioned,
    previousSummary: story.previousSummary,
  }));
  const calendar = input.calendar.events.map((event) => ({
    title: event.title,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    location: event.location,
    calendarName: event.calendarName,
  }));
  const period = briefingDayPeriodPresentation(input.dayPeriod);
  const endOfDay = isEndOfDayBriefing(input.dayPeriod);
  const requiredOrder = endOfDay
    ? "brief greeting; tomorrow's local weather forecast; a clearly labeled summary of today's developments; detailed stories in descending importance; tomorrow's calendar; up to three concrete things to prepare for tomorrow; brief closing"
    : `brief greeting appropriate for ${period.temporalPhrase}; local weather; today's calendar; a short preview of the prepared developments; detailed stories in descending importance; up to three things to watch ${period.watchHorizon}; brief closing`;
  return `You are creating a spoken personal ${input.dayPeriod} intelligence briefing at ${input.localTime} local time.
Write mostly natural English intended to be spoken aloud. Use only the supplied JSON data and do not independently research or invent facts.
The JSON response fields must be spoken prose only and must support this exact assembled order: ${requiredOrder}.
The local day period is authoritative. Never call this a morning, afternoon, evening, or night briefing other than ${input.dayPeriod}, and do not use a greeting for another part of the day.
${endOfDay ? "This is an end-of-day briefing. Summarize what happened today, including important supplied developments even if they were mentioned earlier, then describe what awaits the user tomorrow. The supplied weather forecast and Calendar window are for tomorrow, never today. Do not present tomorrow's conditions or events as current or as having happened already." : ''}
Do not mention internal bot or database names. Combine the supplied cross-domain perspectives into one coherent story while preserving medical, investment, news, and student-community interpretations. For major stories explain what happened, why it matters, what changed, and what to watch next. Use previousSummary only for natural continuity.
If weather or Calendar status is UNAVAILABLE, briefly say it could not be retrieved; never describe it as empty. If DISABLED, omit that section by returning null. If Calendar is AVAILABLE with zero events, it is safe to say the calendar is clear. If there are no stories, explain briefly that there are no new subscribed watcher developments; do not add fake news.
Use the supplied actionAgenda for concrete preparation, deadlines, conflicts, or follow-up. Mention dataQuality briefly only when it is non-empty, without provider error strings or implementation details. ${endOfDay ? 'For previously mentioned stories, use previousSummary only as context for a concise recap and do not claim that an unchanged fact is new.' : 'When previousSummary exists, explicitly explain only the meaningful change since the earlier briefing.'}
Preserve Calendar event titles and story titles in their original language. Write each Czech Calendar event or Czech story title as its own Czech sentence without translating it; keep surrounding narration and non-Czech events in English. This language boundary is required so the speech engine can select the correct voice.
Avoid URLs, markdown, raw field names, filler, excessive numbers, repeated conclusions, and difficult ticker-only phrasing. Stay below ${input.wordBudget} words and never exceed ${input.maximumWords} words. The preferred duration is ${input.targetDurationMinutes} minutes and the hard maximum is ${input.maximumDurationMinutes} minutes, but do not add filler.

SUPPLIED_DATA:
${JSON.stringify({
  date: input.date,
  localTime: input.localTime,
  dayPeriod: input.dayPeriod,
  timezone: input.timezone,
  location: input.location,
  weather: input.weather,
  calendar: { ...input.calendar, events: calendar },
  stories,
  actionAgenda: input.actionAgenda ?? [],
  dataQuality: input.dataQuality ?? [],
})}`;
};

const assemble = (
  sections: z.infer<typeof generatedSectionsSchema>,
  input: ScriptGenerationInput,
): string => {
  const period = briefingDayPeriodPresentation(input.dayPeriod);
  const greeting = `${period.greeting}. Here is your ${input.dayPeriod} briefing for ${input.date}.`;
  const watch =
    sections.watchToday.length > 0
      ? `Things to watch ${period.watchHorizon}. ${sections.watchToday.join(' ')}`
      : undefined;
  const orderedSections = isEndOfDayBriefing(input.dayPeriod)
    ? [
        greeting,
        sections.weather,
        `Today in review. ${sections.newsPreview}`,
        ...sections.topStories,
        sections.calendar ? `Tomorrow. ${sections.calendar}` : undefined,
        watch,
        `That is your ${input.dayPeriod} briefing.`,
      ]
    : [
        greeting,
        sections.weather,
        sections.calendar,
        sections.newsPreview,
        ...sections.topStories,
        watch,
        `That is your ${input.dayPeriod} briefing.`,
      ];
  return orderedSections
    .filter((section): section is string => Boolean(section))
    .join('\n\n');
};

const words = (value: string): string[] => value.trim().split(/\s+/);

const trimToWordLimit = (value: string, maximumWords: number): string => {
  const allWords = words(value);
  if (allWords.length <= maximumWords) return value;
  const bounded = allWords.slice(0, maximumWords).join(' ');
  const sentenceEnd = Math.max(
    bounded.lastIndexOf('.'),
    bounded.lastIndexOf('!'),
    bounded.lastIndexOf('?'),
  );
  return sentenceEnd >= bounded.length / 2
    ? bounded.slice(0, sentenceEnd + 1)
    : `${bounded}…`;
};

const scriptEntities = (
  stories: readonly BriefingStoryCluster[],
): BriefingEntity[] => stories.flatMap(({ entities }) => entities);

const finalizeScript = (
  rawScript: string,
  calendarSection: string | null | undefined,
  input: ScriptGenerationInput,
  metrics: AnalysisMetrics,
): GeneratedBriefingScript => {
  const displayScript = trimToWordLimit(rawScript, input.maximumWords);
  const normalizationInput = {
    entities: scriptEntities(input.stories),
    ...(input.pronunciations ? { pronunciations: input.pronunciations } : {}),
  };
  const ttsScript = normalizeForSpeech(displayScript, normalizationInput);
  const calendarScript = calendarSection
    ? normalizeForSpeech(calendarSection, normalizationInput)
    : undefined;
  return {
    displayScript,
    ttsScript,
    ttsSegments: segmentTtsScriptByCalendarLanguage(
      ttsScript,
      calendarScript,
      input.calendar.events,
    ),
    wordCount: words(displayScript).length,
    metrics,
  };
};

export class BriefingScriptGenerator {
  public constructor(private readonly model: StructuredScriptModel) {}

  public async generate(
    input: ScriptGenerationInput,
    signal?: AbortSignal,
  ): Promise<GeneratedBriefingScript> {
    const generated = await this.model.generateStructuredWithMetrics(
      promptFor(input),
      generatedSectionsJsonSchema,
      generatedSectionsSchema,
      signal,
      { numPredict: Math.min(4_096, Math.ceil(input.wordBudget * 1.6)) },
    );
    return finalizeScript(
      assemble(generated.result, input),
      generated.result.calendar,
      input,
      generated.metrics,
    );
  }
}

export const fallbackBriefingScript = (
  input: ScriptGenerationInput,
): GeneratedBriefingScript => {
  const period = briefingDayPeriodPresentation(input.dayPeriod);
  const endOfDay = isEndOfDayBriefing(input.dayPeriod);
  const calendarSection =
    input.calendar.status === 'AVAILABLE'
      ? input.calendar.spokenSummary
      : input.calendar.status === 'UNAVAILABLE'
        ? `I couldn't retrieve your calendar for ${input.calendar.day}.`
        : undefined;
  const greeting = `${period.greeting}. Here is your ${input.dayPeriod} briefing for ${input.date}.`;
  const storyIntro =
    input.stories.length === 0
      ? 'There are no new subscribed watcher developments to report.'
      : `I found ${input.stories.length} important ${input.stories.length === 1 ? 'development' : 'developments'} worth mentioning.`;
  const stories = input.stories.map(
    ({ title, summary }) => `${title}. ${summary}`,
  );
  const watch = (input.actionAgenda ?? [])
    .slice(0, 3)
    .map((action) => `Watch ${period.watchHorizon}: ${action}`);
  const dataQuality = (input.dataQuality ?? [])
    .slice(0, 2)
    .map((warning) => `Data note: ${warning}`);
  const sections = [
    greeting,
    input.weather.status === 'AVAILABLE'
      ? input.weather.spokenSummary
      : input.weather.status === 'UNAVAILABLE'
        ? `I couldn't retrieve the weather ${period.temporalPhrase}.`
        : undefined,
    ...(endOfDay
      ? [
          `Today in review. ${storyIntro}`,
          ...stories,
          calendarSection ? `Tomorrow. ${calendarSection}` : undefined,
        ]
      : [calendarSection, storyIntro, ...stories]),
    ...watch,
    ...dataQuality,
    `That is your ${input.dayPeriod} briefing.`,
  ].filter((section): section is string => Boolean(section));
  return finalizeScript(sections.join('\n\n'), calendarSection, input, {
    llmCallCount: 0,
    estimatedCostUsd: 0,
  });
};
