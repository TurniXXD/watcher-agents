import { createHash } from 'node:crypto';
import { normalizeSocialText } from '@watcher/database';
import type { TrendSignal } from './types.js';

const stopWords = new Set([
  'about',
  'after',
  'and',
  'are',
  'for',
  'from',
  'how',
  'into',
  'new',
  'that',
  'the',
  'this',
  'with',
  'your',
  'jako',
  'jak',
  'pro',
  'ktery',
  'tento',
  'jsou',
]);

export const trendTokens = (value: string): string[] =>
  normalizeSocialText(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !stopWords.has(token));

const jaccard = (left: readonly string[], right: readonly string[]): number => {
  const a = new Set(left);
  const b = new Set(right);
  const intersection = [...a].filter((value) => b.has(value)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
};

export type ClusterCandidate = {
  canonicalKey: string;
  title: string;
  description?: string;
  keywords: string[];
  signals: Array<TrendSignal & { id: string }>;
};

export const clusterTrendSignals = (
  signals: readonly (TrendSignal & { id: string })[],
): ClusterCandidate[] => {
  const clusters: ClusterCandidate[] = [];
  for (const signal of [...signals].sort((a, b) =>
    a.title.localeCompare(b.title),
  )) {
    const tokens = trendTokens(`${signal.title} ${signal.description ?? ''}`);
    const best = clusters
      .map((cluster) => ({
        cluster,
        similarity: jaccard(tokens, cluster.keywords),
      }))
      .sort((a, b) => b.similarity - a.similarity)[0];
    if (best && best.similarity >= 0.32) {
      best.cluster.signals.push(signal);
      best.cluster.keywords = [
        ...new Set([...best.cluster.keywords, ...tokens]),
      ].slice(0, 30);
      continue;
    }
    const keywords = [...new Set(tokens)].slice(0, 30);
    const canonicalSeed = keywords.slice(0, 8).sort().join('|') || signal.title;
    clusters.push({
      canonicalKey: createHash('sha256').update(canonicalSeed).digest('hex'),
      title: signal.title,
      ...(signal.description ? { description: signal.description } : {}),
      keywords,
      signals: [signal],
    });
  }
  return clusters;
};

type Observation = {
  observedAt: Date;
  views: bigint | null;
  likes: bigint | null;
  comments: bigint | null;
  shares: bigint | null;
  searchInterest: number | null;
};

const observationIndex = (observation: Observation): number | undefined => {
  if (observation.searchInterest !== null) return observation.searchInterest;
  const values = [
    observation.views === null ? undefined : Number(observation.views),
    observation.likes === null ? undefined : Number(observation.likes) * 2,
    observation.comments === null
      ? undefined
      : Number(observation.comments) * 5,
    observation.shares === null ? undefined : Number(observation.shares) * 4,
  ].filter(
    (value): value is number => value !== undefined && Number.isFinite(value),
  );
  return values.length
    ? values.reduce((sum, value) => sum + value, 0)
    : undefined;
};

export type MomentumAssessment = {
  stage:
    | 'EARLY_EMERGING'
    | 'RAPIDLY_GROWING'
    | 'ESTABLISHED'
    | 'DECLINING'
    | 'EVERGREEN'
    | 'UNKNOWN';
  growthPercent?: number;
  observationCount: number;
  independentSourceCount: number;
  ageDays: number;
  persistenceDays: number;
  explanation: string;
  missingData: string[];
};

export const assessMomentum = (
  signals: readonly {
    source: string;
    firstSeenAt: Date;
    lastSeenAt: Date;
    observations: readonly Observation[];
  }[],
  now: Date,
): MomentumAssessment => {
  const observations = signals.flatMap((signal) => signal.observations);
  const independentSourceCount = new Set(signals.map(({ source }) => source))
    .size;
  const firstSeen = Math.min(
    ...signals.map(({ firstSeenAt }) => firstSeenAt.getTime()),
  );
  const lastSeen = Math.max(
    ...signals.map(({ lastSeenAt }) => lastSeenAt.getTime()),
  );
  const ageDays = signals.length
    ? Math.max(0, Math.floor((now.getTime() - firstSeen) / 86_400_000))
    : 0;
  const persistenceDays = signals.length
    ? Math.max(0, Math.floor((lastSeen - firstSeen) / 86_400_000))
    : 0;
  const perSignalGrowth = signals.flatMap((signal) => {
    const measured = signal.observations
      .map((observation) => ({
        observedAt: observation.observedAt,
        value: observationIndex(observation),
      }))
      .filter(
        (entry): entry is { observedAt: Date; value: number } =>
          entry.value !== undefined,
      )
      .sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
    if (measured.length < 2) return [];
    const first = measured[0]!.value;
    const last = measured.at(-1)!.value;
    if (first <= 0) return [];
    return [((last - first) / first) * 100];
  });
  const growthPercent = perSignalGrowth.length
    ? perSignalGrowth.reduce((sum, value) => sum + value, 0) /
      perSignalGrowth.length
    : undefined;
  const missingData: string[] = [];
  if (growthPercent === undefined)
    missingData.push('At least two comparable observations');
  if (independentSourceCount < 2)
    missingData.push('Cross-platform confirmation');
  let stage: MomentumAssessment['stage'] = 'UNKNOWN';
  if (growthPercent !== undefined && growthPercent <= -10) stage = 'DECLINING';
  else if (
    growthPercent !== undefined &&
    growthPercent >= 25 &&
    independentSourceCount >= 2
  ) {
    stage = 'RAPIDLY_GROWING';
  } else if (
    ageDays >= 45 &&
    growthPercent !== undefined &&
    Math.abs(growthPercent) < 10
  ) {
    stage = 'EVERGREEN';
  } else if (ageDays >= 30 && observations.length >= 3) stage = 'ESTABLISHED';
  else if (ageDays <= 14 && independentSourceCount >= 2)
    stage = 'EARLY_EMERGING';
  return {
    stage,
    ...(growthPercent === undefined
      ? {}
      : { growthPercent: Math.round(growthPercent * 10) / 10 }),
    observationCount: observations.length,
    independentSourceCount,
    ageDays,
    persistenceDays,
    explanation:
      growthPercent === undefined
        ? 'Momentum is unknown because fewer than two comparable measurements exist for each signal.'
        : `Measured engagement/search index changed by ${Math.round(growthPercent * 10) / 10}% across repeat observations; this is not an audience-size comparison.`,
    missingData,
  };
};

export type MarketComparison = {
  status:
    | 'EARLY_OPPORTUNITY'
    | 'EMERGING_BOTH'
    | 'ESTABLISHED'
    | 'UNCERTAIN'
    | 'NOT_RELEVANT';
  confidence: number;
  explanation: string;
  missingData: string[];
  usEvidence: Record<string, unknown>;
  czEvidence: Record<string, unknown>;
};

export const compareMarkets = (
  signals: readonly TrendSignal[],
  relevant: boolean,
): MarketComparison => {
  const us = signals.filter(({ region }) => region === 'US');
  const cz = signals.filter(({ region }) => region === 'CZ');
  const usSources = new Set(us.map(({ source }) => source));
  const czSources = new Set(cz.map(({ source }) => source));
  const missingData: string[] = [];
  if (!relevant) {
    return {
      status: 'NOT_RELEVANT',
      confidence: 70,
      explanation:
        'The cluster does not match the configured creator/business focus.',
      missingData,
      usEvidence: { signalCount: us.length, sourceCount: usSources.size },
      czEvidence: { signalCount: cz.length, sourceCount: czSources.size },
    };
  }
  if (!us.length) missingData.push('US evidence');
  if (!cz.length) missingData.push('Czech evidence');
  if (!us.length || !cz.length) {
    return {
      status: 'UNCERTAIN',
      confidence: Math.max(20, 45 - missingData.length * 10),
      explanation:
        'Available evidence does not support a reliable US-versus-Czech trajectory comparison. Missing Czech data is not evidence that the trend is absent.',
      missingData,
      usEvidence: { signalCount: us.length, sourceCount: usSources.size },
      czEvidence: { signalCount: cz.length, sourceCount: czSources.size },
    };
  }
  if (czSources.size >= 2 && cz.length >= 4) {
    return {
      status: 'ESTABLISHED',
      confidence: 70,
      explanation:
        'Multiple independent Czech source signals indicate existing local coverage; raw engagement counts were not compared with the US.',
      missingData,
      usEvidence: { signalCount: us.length, sourceCount: usSources.size },
      czEvidence: { signalCount: cz.length, sourceCount: czSources.size },
    };
  }
  if (usSources.size >= 2 && cz.length <= 2) {
    return {
      status: 'EARLY_OPPORTUNITY',
      confidence: 60,
      explanation:
        'The cluster has cross-source US evidence and limited Czech evidence. This suggests an early localization opportunity, not proof of Czech absence.',
      missingData: [...missingData, 'Broader Czech platform coverage'],
      usEvidence: { signalCount: us.length, sourceCount: usSources.size },
      czEvidence: { signalCount: cz.length, sourceCount: czSources.size },
    };
  }
  return {
    status: 'EMERGING_BOTH',
    confidence: 55,
    explanation:
      'Recent evidence exists in both configured markets, but coverage is too narrow to call the Czech market established.',
    missingData: [...missingData, 'Longer local history'],
    usEvidence: { signalCount: us.length, sourceCount: usSources.size },
    czEvidence: { signalCount: cz.length, sourceCount: czSources.size },
  };
};

export type ScoreWeights = {
  usMomentum: number;
  czechOpportunity: number;
  audienceRelevance: number;
  businessPotential: number;
  contentFeasibility: number;
  evidenceQuality: number;
};

export type OpportunityScore = {
  score: number;
  confidence: number;
  factors: ScoreWeights;
  missingData: string[];
  explanation: string;
};

const bounded = (value: number): number =>
  Math.max(0, Math.min(100, Math.round(value)));

export const scoreTrendOpportunity = (input: {
  cluster: ClusterCandidate;
  momentum: MomentumAssessment;
  comparison: MarketComparison;
  focusTopics: readonly string[];
  audiences: readonly string[];
  weights: ScoreWeights;
  feedback?: { positive: number; negative: number; saturated: number };
}): OpportunityScore => {
  const text = normalizeSocialText(
    `${input.cluster.title} ${input.cluster.description ?? ''} ${input.cluster.keywords.join(' ')}`,
  );
  const focusMatches = input.focusTopics.filter((topic) =>
    trendTokens(topic).some((token) => text.includes(token)),
  ).length;
  const sourceCount = new Set(input.cluster.signals.map(({ source }) => source))
    .size;
  const usMomentum =
    input.momentum.stage === 'RAPIDLY_GROWING'
      ? 90
      : input.momentum.stage === 'EARLY_EMERGING'
        ? 78
        : input.momentum.stage === 'ESTABLISHED'
          ? 60
          : input.momentum.stage === 'EVERGREEN'
            ? 55
            : input.momentum.stage === 'DECLINING'
              ? 25
              : 50;
  const czechOpportunity =
    input.comparison.status === 'EARLY_OPPORTUNITY'
      ? 90
      : input.comparison.status === 'EMERGING_BOTH'
        ? 72
        : input.comparison.status === 'ESTABLISHED'
          ? 45
          : input.comparison.status === 'NOT_RELEVANT'
            ? 10
            : 50;
  const feedback = input.feedback ?? { positive: 0, negative: 0, saturated: 0 };
  const feedbackAdjustment = Math.max(
    -20,
    Math.min(
      15,
      feedback.positive * 2 - feedback.negative * 4 - feedback.saturated * 3,
    ),
  );
  const audienceRelevance = bounded(
    45 + focusMatches * 12 + feedbackAdjustment,
  );
  const businessTerms = [
    'business',
    'firm',
    'automat',
    'software',
    'workflow',
    'saas',
    'client',
    'podnik',
    'web',
    'ai',
  ];
  const businessPotential = bounded(
    45 + businessTerms.filter((term) => text.includes(term)).length * 6,
  );
  const contentFeasibility = bounded(
    65 +
      Number(input.cluster.signals.some(({ source }) => source === 'YOUTUBE')) *
        10,
  );
  const evidenceQuality = bounded(
    25 + sourceCount * 18 + Math.min(20, input.momentum.observationCount * 3),
  );
  const factors = {
    usMomentum,
    czechOpportunity,
    audienceRelevance,
    businessPotential,
    contentFeasibility,
    evidenceQuality,
  };
  const weightTotal = Object.values(input.weights).reduce(
    (sum, value) => sum + value,
    0,
  );
  const score = bounded(
    Object.entries(factors).reduce(
      (sum, [key, value]) =>
        sum + value * input.weights[key as keyof ScoreWeights],
      0,
    ) / Math.max(1, weightTotal),
  );
  const missingData = [
    ...new Set([
      ...input.momentum.missingData,
      ...input.comparison.missingData,
    ]),
  ];
  const confidence = bounded(
    35 +
      sourceCount * 12 +
      Math.min(18, input.momentum.observationCount * 3) -
      missingData.length * 8,
  );
  return {
    score,
    confidence,
    factors,
    missingData,
    explanation: `Score combines configured weights; ${sourceCount} independent source type(s), ${input.momentum.observationCount} observation(s), and ${focusMatches} focus-topic match(es). Missing evidence lowers confidence rather than automatically lowering opportunity.`,
  };
};
