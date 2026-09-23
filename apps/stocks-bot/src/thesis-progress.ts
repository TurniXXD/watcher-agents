import type { ProgressReporter, RunProgress } from '@watcher/core';
import { formatRunDuration, renderRunProgress } from '@watcher/telegram';

type ThesisProgressInput = {
  initialText: string;
  edit: (text: string) => Promise<void>;
  onError: (error: unknown) => void;
  now?: () => number;
  heartbeatMs?: number;
};

export const createThesisProgress = (input: ThesisProgressInput) => {
  const now = input.now ?? Date.now;
  const startedAt = now();
  let current: RunProgress = {
    percent: 0,
    step: 'Checking watcher availability',
  };
  let lastText = input.initialText;
  let stopped = false;
  let pending: Promise<void> = Promise.resolve();
  const textForCurrentState = (): string =>
    renderRunProgress({
      ...current,
      step: `${current.step} · elapsed ${formatRunDuration(now() - startedAt)}`,
    });
  const refresh = (): Promise<void> => {
    if (stopped) return pending;
    const text = textForCurrentState();
    pending = pending.then(async () => {
      if (stopped || text === lastText) return;
      try {
        await input.edit(text);
        lastText = text;
      } catch (error) {
        input.onError(error);
      }
    });
    return pending;
  };
  const onProgress: ProgressReporter = async (progress) => {
    current = progress;
    await refresh();
  };
  const waiting = async (symbol: string): Promise<void> => {
    current = {
      percent: 0,
      step: `Waiting for current watcher run; ${symbol} thesis starts automatically`,
    };
    await refresh();
  };
  const timer = setInterval(() => void refresh(), input.heartbeatMs ?? 10_000);
  timer.unref();
  const stop = async (): Promise<void> => {
    clearInterval(timer);
    stopped = true;
    await pending;
  };
  return { onProgress, waiting, refresh, stop };
};
