import { describe, expect, it } from 'vitest';
import { cidrContains } from '../collectors/rdap.js';

describe('RDAP bootstrap routing', () => {
  it('matches IPv4 and IPv6 addresses to their delegated CIDR', () => {
    expect(cidrContains('8.0.0.0/8', '8.8.8.8')).toBe(true);
    expect(cidrContains('9.0.0.0/8', '8.8.8.8')).toBe(false);
    expect(cidrContains('2001:4800::/23', '2001:4860:4860::8888')).toBe(true);
    expect(cidrContains('2001:db8::/32', '2001:4860:4860::8888')).toBe(false);
  });
});
