import { describe, expect, it } from 'vitest';
import { extractPublicPhone } from '../providers.js';

describe('extractPublicPhone', () => {
  it('uses explicit public tel links only', () => {
    expect(
      extractPublicPhone('<a href="tel:+420%20777%20123%20456">Call</a>'),
    ).toBe('+420 777 123 456');
    expect(extractPublicPhone('Phone: +420 777 123 456')).toBeUndefined();
  });

  it('rejects malformed or too short numbers', () => {
    expect(extractPublicPhone('<a href="tel:123">Call</a>')).toBeUndefined();
    expect(
      extractPublicPhone('<a href="tel:javascript:alert(1)">Call</a>'),
    ).toBeUndefined();
  });
});
