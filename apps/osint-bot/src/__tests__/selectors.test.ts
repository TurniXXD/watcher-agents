import { describe, expect, it } from 'vitest';
import { normalizeDomain, normalizeIco, parseSelectors } from '../selectors.js';
import { selectCollectors } from '../collectors/types.js';

describe('OSINT selector normalization', () => {
  it('extracts a verified IČO from Czech free text', () => {
    expect(parseSelectors('Zjisti firmu IČO 25301632.')).toEqual([
      { type: 'ICO', value: '25301632', original: 'IČO 25301632', depth: 0 },
    ]);
    expect(parseSelectors('25301632')[0]?.value).toBe('25301632');
  });
  it('rejects invalid IČO and unsafe domains', () => {
    expect(() => normalizeIco('25301633')).toThrow(/kontrolní/);
    expect(() => normalizeDomain('http://localhost')).toThrow();
    expect(() => normalizeDomain('127.0.0.1')).toThrow();
    expect(() => normalizeDomain('javascript:alert(1)')).toThrow();
  });
  it('normalizes an internationalized public domain', () => {
    expect(normalizeDomain('https://www.seznam.cz/some/path')).toBe(
      'seznam.cz',
    );
  });
  it('does not mistake company-only text for a person selector', () => {
    expect(parseSelectors('Prověř ACME s.r.o.')[0]?.type).toBe('COMPANY_NAME');
  });
});

describe('deterministic collector priority', () => {
  it('runs only compatible collectors within a budget', () => {
    const calls = [
      {
        id: 'ARES',
        supports: ['ICO'] as const,
        priority: 100,
        collect: async () => [],
      },
      {
        id: 'WEB',
        supports: ['DOMAIN'] as const,
        priority: 20,
        collect: async () => [],
      },
    ];
    const selected = selectCollectors(
      parseSelectors('IČO 25301632 a seznam.cz'),
      calls,
      1,
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]?.collector.id).toBe('ARES');
  });
});
