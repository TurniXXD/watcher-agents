import type { BriefingVoiceId } from '@watcher/database';
import type { BriefingStoryCluster } from './story-types.js';

const initialSpeechRates: Record<BriefingVoiceId, number> = {
  amy: 155,
  hfc_female: 150,
  hfc_male: 145,
};

export type BriefingDurationPlan = {
  plannedMinutes: number;
  wordsPerMinute: number;
  wordBudget: number;
  maximumWords: number;
};

export const planBriefingDuration = (input: {
  stories: readonly BriefingStoryCluster[];
  targetMinutes: number;
  maximumMinutes: number;
  voice: BriefingVoiceId;
  weatherAvailable: boolean;
  calendarEventCount: number;
  measuredWordsPerMinute?: number;
}): BriefingDurationPlan => {
  if (input.targetMinutes <= 0 || input.maximumMinutes < input.targetMinutes) {
    throw new Error('Invalid briefing duration settings');
  }
  const wordsPerMinute = Math.min(
    220,
    Math.max(
      90,
      input.measuredWordsPerMinute ?? initialSpeechRates[input.voice],
    ),
  );
  const contextMinutes =
    1.2 +
    (input.weatherAvailable ? 0.35 : 0) +
    Math.min(1.2, input.calendarEventCount * 0.15);
  const storyMinutes = input.stories.reduce(
    (total, story) => total + 0.35 + story.score / 100,
    0,
  );
  const naturalMinutes = Math.max(3, contextMinutes + storyMinutes);
  const highImportanceRatio =
    input.stories.length === 0
      ? 0
      : input.stories.filter(({ importance }) => importance >= 80).length /
        input.stories.length;
  const plannedMinutes = Math.min(
    input.maximumMinutes,
    naturalMinutes <= input.targetMinutes
      ? naturalMinutes
      : input.targetMinutes +
          (naturalMinutes - input.targetMinutes) * highImportanceRatio,
  );
  return {
    plannedMinutes: Math.round(plannedMinutes * 10) / 10,
    wordsPerMinute,
    wordBudget: Math.floor(plannedMinutes * wordsPerMinute),
    maximumWords: Math.floor(input.maximumMinutes * wordsPerMinute),
  };
};

export const selectStoriesForBudget = (
  stories: readonly BriefingStoryCluster[],
  wordBudget: number,
): BriefingStoryCluster[] => {
  let remaining = Math.max(0, wordBudget - 260);
  return stories.flatMap((story) => {
    const estimatedWords =
      story.score >= 85 ? 150 : story.score >= 70 ? 115 : 85;
    if (estimatedWords > remaining) return [];
    remaining -= estimatedWords;
    return [story];
  });
};
