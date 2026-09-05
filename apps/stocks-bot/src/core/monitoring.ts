import { clamp, type SourceCapabilities } from '@watcher/core';
import type { MonitoringMode, MonitoringTier } from '@watcher/database';

export type MarketSession =
  'PREMARKET' | 'REGULAR_SESSION' | 'AFTER_HOURS' | 'OVERNIGHT';
export type CatalystProximity = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'IMMINENT';

export type MonitoringContext = {
  tier: MonitoringTier;
  mode: MonitoringMode;
  marketSession: MarketSession;
  catalystProximity: CatalystProximity;
  attentionScore: number;
};

export type MonitoringPolicy = {
  tierMultipliers: Record<MonitoringTier, number>;
  modeMultipliers: Record<MonitoringMode, number>;
  catalystMultipliers: Record<CatalystProximity, number>;
  overnightMarketDataMultiplier: number;
  extendedHoursMarketDataMultiplier: number;
  maximumAttentionAcceleration: number;
};

export const defaultMonitoringPolicy: MonitoringPolicy = {
  tierMultipliers: { CORE: 1, WATCH: 2, INVESTIGATE: 1.5, DISCOVERY: 5 },
  modeMultipliers: {
    LOW_RESOLUTION: 4,
    NORMAL: 1,
    HIGH_RESOLUTION: 0.25,
    EVENT_MODE: 0.1,
  },
  catalystMultipliers: {
    NONE: 1,
    LOW: 1,
    MEDIUM: 0.75,
    HIGH: 0.5,
    IMMINENT: 0.25,
  },
  overnightMarketDataMultiplier: 10,
  extendedHoursMarketDataMultiplier: 2,
  maximumAttentionAcceleration: 0.5,
};

export const effectiveSourceIntervalMs = (
  capabilities: SourceCapabilities,
  context: MonitoringContext,
  policy: MonitoringPolicy = defaultMonitoringPolicy,
): number => {
  const attention = clamp(context.attentionScore, 0, 100);
  const attentionMultiplier =
    1 - (attention / 100) * policy.maximumAttentionAcceleration;
  const marketMultiplier =
    capabilities.sourceType !== 'MARKET_DATA'
      ? 1
      : context.marketSession === 'OVERNIGHT'
        ? policy.overnightMarketDataMultiplier
        : context.marketSession === 'PREMARKET' ||
            context.marketSession === 'AFTER_HOURS'
          ? policy.extendedHoursMarketDataMultiplier
          : 1;
  const raw =
    capabilities.preferredIntervalMs *
    policy.tierMultipliers[context.tier] *
    policy.modeMultipliers[context.mode] *
    policy.catalystMultipliers[context.catalystProximity] *
    attentionMultiplier *
    marketMultiplier;
  return Math.round(
    clamp(raw, capabilities.minimumIntervalMs, capabilities.maximumIntervalMs),
  );
};
