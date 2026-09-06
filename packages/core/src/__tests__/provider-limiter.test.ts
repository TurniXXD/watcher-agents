import { describe, expect, it } from 'vitest';
import { ProviderRequestLimiter } from '../provider-limiter.js';
import { SourceHttpError, parseRetryAfter } from '../source-http-error.js';

describe('provider request controls', () => {
  it('parses Retry-After seconds and HTTP dates', () => {
    const now = new Date('2026-09-06T12:00:00.000Z');
    expect(parseRetryAfter('15', now)).toEqual(
      new Date('2026-09-06T12:00:15.000Z'),
    );
    expect(parseRetryAfter('Sun, 06 Sep 2026 12:05:00 GMT', now)).toEqual(
      new Date('2026-09-06T12:05:00.000Z'),
    );
    expect(parseRetryAfter('invalid', now)).toBeUndefined();
  });

  it('serializes one provider and spaces requests without blocking others', async () => {
    let timestamp = 0;
    const starts: number[] = [];
    const limiter = new ProviderRequestLimiter(
      {
        maxConcurrency: 1,
        minimumSpacingMs: 1_000,
        sharedRateLimitBackoff: true,
      },
      () => timestamp,
      async (durationMs) => {
        timestamp += durationMs;
      },
    );

    await Promise.all(
      [1, 2, 3].map((value) =>
        limiter.run(async () => {
          starts.push(timestamp);
          return value;
        }),
      ),
    );

    expect(starts).toEqual([0, 1_000, 2_000]);
  });

  it('stops queued provider requests after a 429 until Retry-After', async () => {
    let timestamp = 0;
    const limiter = new ProviderRequestLimiter(
      {
        maxConcurrency: 1,
        minimumSpacingMs: 0,
        sharedRateLimitBackoff: true,
      },
      () => timestamp,
      async () => undefined,
    );
    const retryAt = new Date(5_000);
    const first = limiter.run(async () => {
      throw new SourceHttpError(429, 'provider.example', retryAt);
    });
    const blocked = limiter.run(async () => 'must not run');

    await expect(first).rejects.toThrow('HTTP 429');
    await expect(blocked).rejects.toThrow(
      'RATE_LIMITED provider backoff active until',
    );
    timestamp = retryAt.getTime();
    await expect(limiter.run(async () => 'recovered')).resolves.toBe(
      'recovered',
    );
  });
});
