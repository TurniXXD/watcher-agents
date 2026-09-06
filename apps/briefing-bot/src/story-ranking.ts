import type { BriefingEvent } from '@watcher/core';
import type { BriefingStoryCluster } from './story-types.js';

export type StoryRankingWeights = {
  importance: number;
  relevance: number;
  novelty: number;
  urgency: number;
  actionableBonus: number;
};

export const defaultStoryRankingWeights: StoryRankingWeights = Object.freeze({
  importance: 0.35,
  relevance: 0.3,
  novelty: 0.15,
  urgency: 0.15,
  actionableBonus: 5,
});

type ScoredStory = Pick<
  BriefingEvent,
  'importance' | 'relevance' | 'novelty' | 'urgency' | 'actionable'
>;

export const briefingScore = (
  story: ScoredStory,
  weights: StoryRankingWeights = defaultStoryRankingWeights,
): number =>
  Math.round(
    Math.min(
      100,
      story.importance * weights.importance +
        story.relevance * weights.relevance +
        story.novelty * weights.novelty +
        story.urgency * weights.urgency +
        (story.actionable ? weights.actionableBonus : 0),
    ) * 100,
  ) / 100;

export const rankStories = (
  stories: readonly BriefingStoryCluster[],
): BriefingStoryCluster[] =>
  [...stories].sort(
    (left, right) =>
      right.score - left.score ||
      right.lastEventAt.localeCompare(left.lastEventAt) ||
      left.id.localeCompare(right.id),
  );
