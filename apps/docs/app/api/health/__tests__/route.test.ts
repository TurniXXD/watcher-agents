import { describe, expect, it } from 'vitest';
import { GET } from '../route.js';

describe('documentation health route', () => {
  it('returns an uncached healthy response', async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });
});
