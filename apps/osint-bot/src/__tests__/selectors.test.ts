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
  it('accepts an explicitly labeled address without treating it as a name', () => {
    expect(parseSelectors('adresa: Česká 1, Brno')).toEqual([
      {
        type: 'ADDRESS',
        value: 'Česká 1, Brno',
        original: 'adresa: Česká 1, Brno',
        depth: 0,
      },
    ]);
  });
  it('recognizes IPv4 and IPv6 selectors', () => {
    expect(parseSelectors('8.8.8.8')[0]).toMatchObject({
      type: 'IP_ADDRESS',
      value: '8.8.8.8',
    });
    expect(parseSelectors('ip: 2001:4860:4860::8888')[0]).toMatchObject({
      type: 'IP_ADDRESS',
      value: '2001:4860:4860::8888',
    });
  });
  it('recognizes explicit public profile and research identifiers', () => {
    expect(parseSelectors('github: octocat')[0]).toMatchObject({
      type: 'GITHUB_PROFILE',
      value: 'octocat',
    });
    expect(parseSelectors('reddit: u/example_user')[0]).toMatchObject({
      type: 'REDDIT_USERNAME',
      value: 'example_user',
    });
    expect(parseSelectors('0000-0002-1825-0097')[0]).toMatchObject({
      type: 'ORCID',
      value: '0000-0002-1825-0097',
    });
    expect(parseSelectors('10.1000/example-doi')[0]).toMatchObject({
      type: 'DOI',
      value: '10.1000/example-doi',
    });
  });
  it('keeps exact e-mail evidence separate from its public domain', () => {
    expect(parseSelectors('Kontakt: test@example.com')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'EMAIL', value: 'test@example.com' }),
        expect.objectContaining({ type: 'DOMAIN', value: 'example.com' }),
      ]),
    );
  });
  it('recognizes public profile URLs and blockchain addresses', () => {
    expect(parseSelectors('https://github.com/octocat')[0]).toMatchObject({
      type: 'GITHUB_PROFILE',
      value: 'octocat',
    });
    expect(
      parseSelectors('0x0000000000000000000000000000000000000000')[0],
    ).toMatchObject({ type: 'ETHEREUM_ADDRESS' });
    expect(
      parseSelectors('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh')[0],
    ).toMatchObject({ type: 'BITCOIN_ADDRESS' });
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
