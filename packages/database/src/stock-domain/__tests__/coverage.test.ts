import { describe, expect, it } from 'vitest';
import { assessSignalCoverage } from '../coverage.js';

const freeCoreSources = new Set([
  'SEC',
  'ZACKS',
  'EARNINGS_WHISPERS',
  'FINVIZ',
  'ALPHA_VANTAGE_INSTITUTIONAL',
  'PRICE',
  'NEWS',
  'FINRA_SHORT_INTEREST',
]);

describe('stock signal coverage', () => {
  it('does not require a paid options provider for complete core coverage', () => {
    const result = assessSignalCoverage(
      freeCoreSources,
      new Map(),
      freeCoreSources,
    );

    expect(result.dataCoverage).toBe(100);
    expect(result.materialDataGaps).not.toContain('OPTIONS_POSITIONING');
    expect(result.dataAvailability).toContainEqual({
      group: 'OPTIONS_POSITIONING',
      weight: 1,
      availability: 'NOT_APPLICABLE',
      reason:
        'This optional signal has no configured provider and is not required for core thesis coverage.',
    });
  });

  it('reports options as a material gap when an enabled provider is unhealthy', () => {
    const enabled = new Set([...freeCoreSources, 'ALPHA_VANTAGE_OPTIONS']);
    const health = new Map([
      ['ALPHA_VANTAGE_OPTIONS', { status: 'UNAVAILABLE' as const }],
    ]);
    const result = assessSignalCoverage(enabled, health, enabled);

    expect(result.dataCoverage).toBe(93);
    expect(result.materialDataGaps).toContain('OPTIONS_POSITIONING');
  });
});
