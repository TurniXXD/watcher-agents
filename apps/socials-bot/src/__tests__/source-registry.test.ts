import { describe, expect, it } from 'vitest';
import { socialEventSources } from '../source-registry.js';

describe('social event source registry', () => {
  it('distinguishes working aggregation from manual-only discovery links', () => {
    expect(
      socialEventSources.find(({ id }) => id === 'brno-events')?.mode,
    ).toBe('OPERATIONAL');
    expect(socialEventSources.find(({ id }) => id === 'jic')?.mode).toBe(
      'AGGREGATED',
    );
    expect(
      socialEventSources.find(({ id }) => id === 'meetup-ostrava')?.mode,
    ).toBe('MANUAL_ONLY');
    expect(socialEventSources.find(({ id }) => id === 'msic')?.notes).toContain(
      'není',
    );
  });
});
