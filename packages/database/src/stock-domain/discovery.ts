import { createHash } from 'node:crypto';
import { z } from 'zod';

export const discoveryScanModeSchema = z.enum(['DAILY', 'INTRADAY']);
export type DiscoveryScanMode = z.infer<typeof discoveryScanModeSchema>;

export const discoveryTriggerSchema = z.enum(['PRICE_MOVE', 'MOST_ACTIVE']);
export type DiscoveryTrigger = z.infer<typeof discoveryTriggerSchema>;

export const marketDiscoveryObservationSchema = z.object({
  ticker: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .transform((value) => value.toUpperCase()),
  price: z.number().positive(),
  changePercent: z.number(),
  volume: z.number().int().nonnegative(),
  observedAt: z.date(),
  snapshotId: z.string().trim().min(1).optional(),
  source: z.string().min(1),
  trigger: discoveryTriggerSchema,
});
export type MarketDiscoveryObservation = z.infer<
  typeof marketDiscoveryObservationSchema
>;

export type DiscoveryPolicy = {
  moveThresholdPercent: number;
  minimumPrice: number;
  minimumVolume: number;
  minimumDollarVolume: number;
  maximumCandidates: number;
  supportedTicker: RegExp;
  supportedExchanges: readonly string[];
  excludeOtc: boolean;
};

export const defaultDiscoveryPolicy: DiscoveryPolicy = {
  moveThresholdPercent: 4,
  minimumPrice: 2,
  minimumVolume: 100_000,
  minimumDollarVolume: 1_000_000,
  maximumCandidates: 10,
  supportedTicker: /^[A-Z][A-Z0-9-]{0,9}$/,
  supportedExchanges: ['NASDAQ', 'NYSE', 'NYSE AMERICAN'],
  excludeOtc: true,
};

export const discoveryCompanyIsEligible = (
  exchange: string | null,
  policy: DiscoveryPolicy,
): boolean => {
  const normalized = exchange?.trim().toUpperCase() ?? '';
  if (policy.excludeOtc && normalized.includes('OTC')) {
    return false;
  }
  return (
    policy.supportedExchanges.length === 0 ||
    policy.supportedExchanges.some(
      (candidate) => candidate.trim().toUpperCase() === normalized,
    )
  );
};

export type DiscoveryCandidate = MarketDiscoveryObservation & {
  dollarVolume: number;
  attentionScore: number;
  reason: string;
  fingerprint: string;
};

export interface MarketDiscoveryScanner {
  readonly id: string;
  scan(
    mode: DiscoveryScanMode,
    signal?: AbortSignal,
  ): Promise<MarketDiscoveryObservation[]>;
}

const attentionScore = (changePercent: number): number => {
  const move = Math.abs(changePercent);
  if (move >= 15) {
    return 98;
  }
  if (move >= 10) {
    return 92;
  }
  if (move >= 7.5) {
    return 85;
  }
  if (move >= 6) {
    return 78;
  }
  return 65;
};

export const selectDiscoveryCandidates = (
  observations: MarketDiscoveryObservation[],
  policy: DiscoveryPolicy = defaultDiscoveryPolicy,
): DiscoveryCandidate[] => {
  const candidates = new Map<string, DiscoveryCandidate>();
  for (const raw of observations) {
    const observation = marketDiscoveryObservationSchema.parse(raw);
    const dollarVolume = observation.price * observation.volume;
    if (
      !policy.supportedTicker.test(observation.ticker) ||
      observation.price < policy.minimumPrice ||
      observation.volume < policy.minimumVolume ||
      dollarVolume < policy.minimumDollarVolume ||
      Math.abs(observation.changePercent) < policy.moveThresholdPercent
    ) {
      continue;
    }
    const reason = `${observation.changePercent >= 0 ? '+' : ''}${observation.changePercent.toFixed(2)}% price move on ${observation.volume.toLocaleString('en-US')} shares`;
    const identity = [
      observation.source,
      observation.ticker,
      observation.snapshotId ?? observation.observedAt.toISOString(),
      observation.price.toFixed(8),
      observation.changePercent.toFixed(4),
      observation.volume,
    ].join(':');
    const candidate: DiscoveryCandidate = {
      ...observation,
      dollarVolume,
      attentionScore: attentionScore(observation.changePercent),
      reason,
      fingerprint: createHash('sha256').update(identity).digest('hex'),
    };
    const current = candidates.get(candidate.ticker);
    if (
      !current ||
      Math.abs(candidate.changePercent) > Math.abs(current.changePercent)
    ) {
      candidates.set(candidate.ticker, candidate);
    }
  }
  return [...candidates.values()]
    .sort(
      (left, right) =>
        right.attentionScore - left.attentionScore ||
        right.dollarVolume - left.dollarVolume,
    )
    .slice(0, policy.maximumCandidates);
};

export type InvestigationExpiryDecision =
  | { action: 'KEEP' }
  | { action: 'RETURN_TO_DISCOVERY'; reason: string }
  | { action: 'NORMALIZE_WATCH_MODE'; reason: string };

export const investigationExpiryDecision = (input: {
  tier: 'CORE' | 'WATCH' | 'DISCOVERY' | 'INVESTIGATE';
  mode: 'LOW_RESOLUTION' | 'NORMAL' | 'HIGH_RESOLUTION' | 'EVENT_MODE';
  investigateUntil: Date | null;
  highResolutionUntil: Date | null;
  now: Date;
}): InvestigationExpiryDecision => {
  if (
    input.tier === 'INVESTIGATE' &&
    input.investigateUntil &&
    input.investigateUntil <= input.now
  ) {
    return {
      action: 'RETURN_TO_DISCOVERY',
      reason: 'Investigation expired without a high-materiality event.',
    };
  }
  if (
    (input.tier === 'WATCH' || input.tier === 'CORE') &&
    (input.mode === 'HIGH_RESOLUTION' || input.mode === 'EVENT_MODE') &&
    input.highResolutionUntil &&
    input.highResolutionUntil <= input.now
  ) {
    return {
      action: 'NORMALIZE_WATCH_MODE',
      reason: 'Temporary high-resolution monitoring expired.',
    };
  }
  return { action: 'KEEP' };
};
