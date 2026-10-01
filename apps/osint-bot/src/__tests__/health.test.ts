import { describe, expect, it } from 'vitest';
import { osintHealthResponse } from '../health.js';

describe('OSINT readiness', () => {
  it('is unavailable until the Telegram poller starts', () => {
    expect(osintHealthResponse('GET', '/healthz', false)).toEqual({
      statusCode: 503,
      body: { status: 'starting' },
    });
    expect(osintHealthResponse('GET', '/healthz', true)).toEqual({
      statusCode: 200,
      body: { status: 'ready' },
    });
    expect(osintHealthResponse('POST', '/healthz', true)).toEqual({
      statusCode: 404,
      body: null,
    });
  });
});
