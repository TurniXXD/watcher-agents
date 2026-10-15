import {
  isTransientError,
  sourceHttpError,
  sourceRetryAt,
} from '@watcher/core';
import type { z } from 'zod';

export type TrendHttpOptions = {
  fetch?: typeof fetch;
  timeoutMs?: number;
  attempts?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
  acceptableStatus?: (status: number) => boolean;
};

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const retryableStatus = new Set([408, 425, 429, 500, 502, 503, 504]);

export const fetchWithTrendRetry = async (
  input: string | URL,
  init: RequestInit,
  options: TrendHttpOptions = {},
): Promise<Response> => {
  const attempts = Math.max(1, Math.min(options.attempts ?? 3, 5));
  const now = options.now ?? (() => new Date());
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await (options.fetch ?? fetch)(input, {
        ...init,
        signal: init.signal
          ? AbortSignal.any([
              init.signal,
              AbortSignal.timeout(options.timeoutMs ?? 20_000),
            ])
          : AbortSignal.timeout(options.timeoutMs ?? 20_000),
      });
      if (
        response.ok ||
        (options.acceptableStatus?.(response.status) ?? false)
      ) {
        return response;
      }
      throw sourceHttpError(response, input, now());
    } catch (error) {
      const status =
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        typeof error.status === 'number'
          ? error.status
          : undefined;
      if (
        attempt >= attempts ||
        (!isTransientError(error) &&
          (status === undefined || !retryableStatus.has(status)))
      ) {
        throw error;
      }
      const retryAt = sourceRetryAt(error);
      const retryDelay = retryAt
        ? Math.max(0, retryAt.getTime() - now().getTime())
        : 250 * 2 ** (attempt - 1);
      await (options.sleep ?? sleep)(Math.min(30_000, retryDelay));
    }
  }
};

export const fetchTrendJson = async <T>(
  input: string | URL,
  schema: z.ZodType<T>,
  options: TrendHttpOptions = {},
  init: RequestInit = {},
): Promise<T> => {
  const response = await fetchWithTrendRetry(input, init, options);
  return schema.parse(await response.json());
};

export const mapWithConcurrency = async <Input, Output>(
  values: readonly Input[],
  concurrency: number,
  mapper: (value: Input, index: number) => Promise<Output>,
): Promise<PromiseSettledResult<Output>[]> => {
  const results: Array<PromiseSettledResult<Output> | undefined> = Array.from({
    length: values.length,
  });
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const value = values[index];
      if (value === undefined) {
        return;
      }
      try {
        results[index] = {
          status: 'fulfilled',
          value: await mapper(value, index),
        };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(values.length, Math.max(1, concurrency)) },
      worker,
    ),
  );
  return results.map((result) => {
    if (!result) {
      throw new Error('Concurrent trend mapping omitted a result');
    }
    return result;
  });
};
