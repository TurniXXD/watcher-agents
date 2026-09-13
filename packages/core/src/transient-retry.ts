import { SourceHttpError } from './source-http-error.js';

const transientCodes = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

const errorChain = (error: unknown): unknown[] => {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && current !== null && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    current =
      typeof current === 'object' && 'cause' in current
        ? current.cause
        : undefined;
  }
  return chain.slice(0, 8);
};

const errorCode = (error: unknown): string | undefined =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  typeof error.code === 'string'
    ? error.code.toUpperCase()
    : undefined;

export const isTransientError = (error: unknown): boolean =>
  errorChain(error).some((entry) => {
    if (entry instanceof SourceHttpError) {
      return [408, 425, 500, 502, 503, 504].includes(entry.status);
    }
    const code = errorCode(entry);
    if (code && transientCodes.has(code)) return true;
    if (!(entry instanceof Error)) return false;
    if (entry.name === 'TimeoutError') return true;
    if (entry.name === 'AbortError') return false;
    return /\b(?:408|425|500|502|503|504)\b|eai_again|fetch failed|invalid json|malformed|network error|socket|temporar(?:y|ily)|terminated|timed? ?out|timeout|truncated|unexpected end|unexpected token/iu.test(
      entry.message,
    );
  });

const sleepFor = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export type TransientRetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  maximumDelayMs?: number;
  signal?: AbortSignal;
  sleep?: (milliseconds: number) => Promise<void>;
};

export const retryTransient = async <T>(
  task: (attempt: number) => Promise<T>,
  options: TransientRetryOptions = {},
): Promise<T> => {
  const attempts = Math.max(1, Math.min(options.attempts ?? 3, 5));
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 1_000);
  const maximumDelayMs = Math.max(baseDelayMs, options.maximumDelayMs ?? 4_000);
  for (let attempt = 1; ; attempt += 1) {
    if (options.signal?.aborted) throw options.signal.reason;
    try {
      return await task(attempt);
    } catch (error) {
      if (
        attempt >= attempts ||
        options.signal?.aborted ||
        !isTransientError(error)
      ) {
        throw error;
      }
      const delay = Math.min(maximumDelayMs, baseDelayMs * 2 ** (attempt - 1));
      await (options.sleep ?? sleepFor)(delay);
    }
  }
};
