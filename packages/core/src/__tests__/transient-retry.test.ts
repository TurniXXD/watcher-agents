import { describe, expect, it, vi } from 'vitest';
import { SourceHttpError } from '../source-http-error.js';
import { isTransientError, retryTransient } from '../transient-retry.js';
import { errorMessage } from '../utils/general.js';

describe('transient retries', () => {
  it('retries bounded DNS failures with exponential delays', async () => {
    const cause = Object.assign(new Error('temporary DNS lookup failure'), {
      code: 'EAI_AGAIN',
    });
    const task = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed', { cause }))
      .mockRejectedValueOnce(new TypeError('fetch failed', { cause }))
      .mockResolvedValue('ok');
    const sleep = vi.fn(async () => undefined);

    await expect(
      retryTransient(task, { baseDelayMs: 250, sleep }),
    ).resolves.toBe('ok');

    expect(task).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[250], [500]]);
  });

  it('does not retry client errors, rate limits, or cancellations', async () => {
    const sleep = vi.fn(async () => undefined);
    for (const error of [
      new SourceHttpError(404, 'example.test'),
      new SourceHttpError(429, 'example.test'),
      new DOMException('cancelled', 'AbortError'),
    ]) {
      const task = vi.fn(async () => Promise.reject(error));
      await expect(retryTransient(task, { sleep })).rejects.toBe(error);
      expect(task).toHaveBeenCalledOnce();
    }
    expect(sleep).not.toHaveBeenCalled();
  });

  it('recognizes server and malformed-response failures as transient', () => {
    expect(isTransientError(new SourceHttpError(503, 'example.test'))).toBe(
      true,
    );
    expect(isTransientError(new SyntaxError('Unexpected token P'))).toBe(true);
  });

  it('keeps nested transport details in the persisted error message', () => {
    const cause = Object.assign(new Error('DNS lookup failed'), {
      code: 'EAI_AGAIN',
    });
    expect(errorMessage(new TypeError('fetch failed', { cause }))).toBe(
      'fetch failed — DNS lookup failed — EAI_AGAIN',
    );
  });
});
