import { describe, expect, it } from 'vitest';
import {
  clamp,
  errorMessage,
  finiteNumber,
  isRecord,
  parseDate,
  recordValue,
} from '../utils/general.js';
import { assertPublicHttpUrl } from '../utils/network.js';

describe('shared utilities', () => {
  it('parses supported date representations consistently', () => {
    expect(parseDate('20260905')?.toISOString()).toBe(
      '2026-09-05T00:00:00.000Z',
    );
    expect(parseDate('2026-09-05T12:30:00Z')?.toISOString()).toBe(
      '2026-09-05T12:30:00.000Z',
    );
    expect(parseDate('20260905T123000Z')?.toISOString()).toBe(
      '2026-09-05T12:30:00.000Z',
    );
    expect(parseDate(1_788_609_600)?.toISOString()).toBe(
      '2026-09-05T12:00:00.000Z',
    );
    expect(parseDate(1_788_609_600_000)?.toISOString()).toBe(
      '2026-09-05T12:00:00.000Z',
    );
    expect(parseDate('invalid')).toBeUndefined();
    expect(parseDate(null)).toBeUndefined();
  });

  it('normalizes finite numeric source values', () => {
    expect(finiteNumber('$1,234.50')).toBe(1234.5);
    expect(finiteNumber('(12.5%)')).toBe(-12.5);
    expect(finiteNumber('')).toBeNull();
    expect(finiteNumber(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('provides common bounds and error formatting', () => {
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(errorMessage(new Error('failure'))).toBe('failure');
    expect(errorMessage('failure')).toBe('failure');
  });

  it('recognizes plain records without accepting arrays', () => {
    expect(isRecord({ key: 'value' })).toBe(true);
    expect(isRecord(['value'])).toBe(false);
    expect(recordValue({ key: 'value' })).toEqual({ key: 'value' });
    expect(recordValue(null)).toEqual({});
  });

  it('allows public 192.0.x addresses without allowing reserved ranges', () => {
    expect(() =>
      assertPublicHttpUrl('https://192.0.66.184/feed'),
    ).not.toThrow();
    expect(() => assertPublicHttpUrl('https://192.0.0.1/feed')).toThrow();
    expect(() => assertPublicHttpUrl('https://192.0.2.1/feed')).toThrow();
    expect(() => assertPublicHttpUrl('https://192.168.1.1/feed')).toThrow();
    expect(() => assertPublicHttpUrl('https://198.51.100.1/feed')).toThrow();
    expect(() => assertPublicHttpUrl('https://203.0.113.1/feed')).toThrow();
  });
});
