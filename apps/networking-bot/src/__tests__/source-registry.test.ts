import { describe, expect, it } from 'vitest';
import { networkingEventSources } from '../source-registry.js';

describe('networking event source registry', () => {
  it('reports every dedicated networking source as aggregated', () => {
    for (const id of [
      'velvet-innovation',
      'sidequesty',
      'objev-brno',
      'impact-hub-brno',
      'base48-calendar',
      'csob-validation-camps',
    ]) {
      expect(
        networkingEventSources.find((source) => source.id === id)?.mode,
      ).toBe('AGGREGATED');
    }
  });
});
