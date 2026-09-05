import {
  signalGroupSchema,
  type SignalGroup,
  type SignalGroupAvailability,
} from '@watcher/core';

const signalCoverage: ReadonlyArray<{
  group: SignalGroup;
  weight: number;
  sources: string[];
}> = [
  {
    group: 'FUNDAMENTALS',
    weight: 1.4,
    sources: ['SEC', 'INVESTOR_RELATIONS'],
  },
  {
    group: 'EARNINGS_MOMENTUM',
    weight: 1.4,
    sources: ['SEC', 'INVESTOR_RELATIONS', 'ZACKS', 'EARNINGS_WHISPERS'],
  },
  {
    group: 'ANALYST_ESTIMATE_REVISIONS',
    weight: 1,
    sources: ['ZACKS', 'EARNINGS_WHISPERS'],
  },
  {
    group: 'INSIDER_ACTIVITY',
    weight: 1.2,
    sources: ['SEC', 'FINVIZ', 'QUIVER_INSIDERS'],
  },
  {
    group: 'INSTITUTIONAL_POSITIONING',
    weight: 1,
    sources: ['ALPHA_VANTAGE_INSTITUTIONAL'],
  },
  {
    group: 'OPTIONS_POSITIONING',
    weight: 1,
    sources: ['ALPHA_VANTAGE_OPTIONS'],
  },
  { group: 'PRICE_ACTION', weight: 0.9, sources: ['PRICE'] },
  { group: 'VALUATION', weight: 1, sources: ['SEC', 'ZACKS'] },
  {
    group: 'CATALYST_SETUP',
    weight: 1.4,
    sources: [
      'SEC',
      'INVESTOR_RELATIONS',
      'NEWS',
      'TRADINGVIEW_NEWS',
      'EARNINGS_WHISPERS',
      'QUIVER_CONTRACTS',
      'QUIVER_PATENTS',
      'CLINICAL_TRIALS',
      'FDA',
    ],
  },
  {
    group: 'COMPETITIVE_POSITION',
    weight: 1,
    sources: ['SEC', 'INVESTOR_RELATIONS', 'NEWS', 'TRADINGVIEW_NEWS'],
  },
  {
    group: 'BALANCE_SHEET_FINANCIAL_RISK',
    weight: 1.4,
    sources: ['SEC', 'INVESTOR_RELATIONS'],
  },
  {
    group: 'MACRO_SECTOR_CONDITIONS',
    weight: 1,
    sources: ['NEWS', 'TRADINGVIEW_NEWS'],
  },
  {
    group: 'ALTERNATIVE_DATA',
    weight: 0.7,
    sources: [
      'QUIVER_CONTRACTS',
      'QUIVER_PATENTS',
      'QUIVER_CONGRESS',
      'QUIVER_OFF_EXCHANGE',
      'QUIVER_LOBBYING',
      'FINRA_SHORT_INTEREST',
    ],
  },
];

if (signalCoverage.length !== signalGroupSchema.options.length) {
  throw new Error('Signal coverage map must include every signal group');
}

export const assessSignalCoverage = (
  enabledSources: ReadonlySet<string>,
  healthBySource: ReadonlyMap<
    string,
    { status: 'HEALTHY' | 'DEGRADED' | 'RATE_LIMITED' | 'UNAVAILABLE' }
  >,
  availableSourceIds?: ReadonlySet<string>,
): {
  dataAvailability: SignalGroupAvailability[];
  dataCoverage: number;
  dataQuality: 'LOW' | 'MEDIUM' | 'HIGH';
  materialDataGaps: SignalGroup[];
} => {
  const dataAvailability = signalCoverage.map(({ group, weight, sources }) => {
    const configured = sources.filter(
      (source) =>
        enabledSources.has(source) && (availableSourceIds?.has(source) ?? true),
    );
    if (!configured.length) {
      return {
        group,
        weight,
        availability: 'DATA_UNAVAILABLE' as const,
        reason:
          'Every provider capable of this signal group is disabled or unavailable.',
      };
    }
    const usable = configured.some((source) => {
      const status = healthBySource.get(source)?.status;
      return status !== 'UNAVAILABLE' && status !== 'RATE_LIMITED';
    });
    return {
      group,
      weight,
      availability: usable
        ? ('AVAILABLE' as const)
        : ('DATA_UNAVAILABLE' as const),
      reason: usable
        ? `Covered by configured source(s): ${configured.join(', ')}.`
        : `Configured source(s) are unavailable: ${configured.join(', ')}.`,
    };
  });
  const totalWeight = dataAvailability.reduce(
    (total, entry) => total + entry.weight,
    0,
  );
  const availableWeight = dataAvailability
    .filter(({ availability }) => availability === 'AVAILABLE')
    .reduce((total, entry) => total + entry.weight, 0);
  const dataCoverage =
    totalWeight === 0 ? 100 : Math.round((availableWeight / totalWeight) * 100);
  return {
    dataAvailability,
    dataCoverage,
    dataQuality:
      dataCoverage >= 85 ? 'HIGH' : dataCoverage >= 60 ? 'MEDIUM' : 'LOW',
    materialDataGaps: dataAvailability
      .filter(
        ({ availability, weight }) =>
          availability === 'DATA_UNAVAILABLE' && weight >= 1,
      )
      .map(({ group }) => group),
  };
};
