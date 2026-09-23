import { setTimeout as delay } from 'node:timers/promises';
import type { RunExecution } from '@watcher/core';

type WaitForThesisRunInput = {
  execute: () => Promise<RunExecution>;
  onBusy: () => Promise<void> | void;
  signal?: AbortSignal;
  retryIntervalMs?: number;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
};

const waitForRetry = async (
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> => {
  await delay(milliseconds, undefined, signal ? { signal } : undefined);
};

export const runThesisWhenAvailable = async (
  input: WaitForThesisRunInput,
): Promise<Exclude<RunExecution, { status: 'BUSY' }>> => {
  const retryIntervalMs = input.retryIntervalMs ?? 10_000;
  if (!Number.isFinite(retryIntervalMs) || retryIntervalMs <= 0) {
    throw new Error('Thesis retry interval must be positive');
  }
  for (;;) {
    input.signal?.throwIfAborted();
    const execution = await input.execute();
    if (execution.status !== 'BUSY') return execution;
    await input.onBusy();
    await (input.wait ?? waitForRetry)(retryIntervalMs, input.signal);
  }
};
