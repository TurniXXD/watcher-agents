import { describe, expect, it } from 'vitest';
import { networkingEventSources } from '../source-registry.js';

describe('networking event source registry', () => {
  it('reports Velvet Innovation and SideQuesty as aggregated sources', () => {
    expect(
      networkingEventSources.find(({ id }) => id === 'velvet-innovation')?.mode,
    ).toBe('AGGREGATED');
    expect(
      networkingEventSources.find(({ id }) => id === 'sidequesty')?.mode,
    ).toBe('AGGREGATED');
  });
});
