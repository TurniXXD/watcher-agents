import { describe, expect, it } from 'vitest';
import { assertPublicHttpUrl } from '../network.js';

describe('stock source network safety', () => {
  it('rejects private and non-HTTP source URLs', () => {
    expect(() => assertPublicHttpUrl('http://127.0.0.1/feed')).toThrow();
    expect(() => assertPublicHttpUrl('http://[::1]/feed')).toThrow();
    expect(() => assertPublicHttpUrl('file:///etc/passwd')).toThrow();
  });
});
