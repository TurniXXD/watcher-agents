import { afterEach, describe, expect, it, vi } from 'vitest';
import { createThesisProgress } from '../thesis-progress.js';

afterEach(() => vi.useRealTimers());

describe('createThesisProgress', () => {
  it('keeps the waiting bar updated, then shows live-run progress', async () => {
    vi.useFakeTimers();
    const edits: string[] = [];
    const onError = vi.fn();
    const progress = createThesisProgress({
      initialText: 'initial',
      edit: async (text) => {
        edits.push(text);
      },
      onError,
      now: () => Date.now(),
      heartbeatMs: 10_000,
    });

    await progress.waiting('MU');
    expect(edits.at(-1)).toContain('Waiting for current watcher run');
    expect(edits.at(-1)).toContain('0%');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(edits.at(-1)).toContain('elapsed 10s');
    await progress.onProgress({ percent: 45, step: 'Analyzing MU' });
    expect(edits.at(-1)).toContain('45%');
    expect(edits.at(-1)).toContain('Analyzing MU');

    const editCount = edits.length;
    await progress.stop();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(edits).toHaveLength(editCount);
    expect(onError).not.toHaveBeenCalled();
  });
});
