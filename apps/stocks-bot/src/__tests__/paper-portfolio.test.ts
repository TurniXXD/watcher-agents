import { describe, expect, it } from 'vitest';
import {
  parsePaperCloseOrdinal,
  parsePaperOpenRequest,
} from '../paper-portfolio.js';

describe('paper portfolio command parsing', () => {
  it('parses a paper position with an explicit CZK notional', () => {
    expect(parsePaperOpenRequest('mu --amount-czk 10000 --days 90')).toEqual({
      symbol: 'MU',
      amountCzk: 10_000,
      days: 90,
    });
  });

  it('requires a CZK notional and rejects unknown flags', () => {
    expect(() => parsePaperOpenRequest('MU --days 30')).toThrow('Usage:');
    expect(() => parsePaperOpenRequest('MU --amount-czk 100 --live')).toThrow(
      'Usage:',
    );
  });

  it('accepts only a positive paper-position ordinal', () => {
    expect(parsePaperCloseOrdinal('2')).toBe(2);
    expect(() => parsePaperCloseOrdinal('0')).toThrow();
    expect(() => parsePaperCloseOrdinal('1 2')).toThrow('Usage:');
  });
});
