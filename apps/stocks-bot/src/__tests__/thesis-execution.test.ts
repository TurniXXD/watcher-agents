import { describe, expect, it, vi } from 'vitest';
import { runThesisWhenAvailable } from '../thesis-execution.js';

describe('runThesisWhenAvailable', () => {
  it('automatically starts the thesis run when the current watcher run finishes', async () => {
    const completed = {
      status: 'FAILED' as const,
      error: 'test',
      durationMs: 10,
    };
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ status: 'BUSY' })
      .mockResolvedValueOnce({ status: 'BUSY' })
      .mockResolvedValueOnce(completed);
    const onBusy = vi.fn();
    const wait = vi.fn().mockResolvedValue(undefined);

    expect(
      await runThesisWhenAvailable({
        execute,
        onBusy,
        wait,
        retryIntervalMs: 5_000,
      }),
    ).toEqual(completed);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(onBusy).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(5_000, undefined);
  });

  it('does not continue waiting after shutdown', async () => {
    const controller = new AbortController();
    const execute = vi.fn().mockResolvedValue({ status: 'BUSY' });
    const wait = vi.fn(async () => {
      controller.abort();
    });

    await expect(
      runThesisWhenAvailable({
        execute,
        onBusy: vi.fn(),
        signal: controller.signal,
        wait,
      }),
    ).rejects.toBeDefined();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
