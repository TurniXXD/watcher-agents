import { sourceHttpError } from '@watcher/core';

const signalFor = (signal?: AbortSignal): AbortSignal =>
  signal
    ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
    : AbortSignal.timeout(30_000);

const transientTransportError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  if (error.name === 'AbortError' || error.name === 'TimeoutError') {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes('terminated') ||
    message.includes('fetch failed') ||
    message.includes('socket') ||
    message.includes('econnreset') ||
    message.includes('und_err')
  );
};

const withTransientRetry = async <T>(task: () => Promise<T>): Promise<T> => {
  try {
    return await task();
  } catch (error) {
    if (!transientTransportError(error)) throw error;
    return task();
  }
};

export const fetchJson = async (
  fetcher: typeof fetch,
  url: string,
  signal?: AbortSignal,
): Promise<unknown> =>
  withTransientRetry(async () => {
    const response = await fetcher(url, {
      headers: { accept: 'application/json', 'user-agent': 'Watcher/1.0' },
      signal: signalFor(signal),
    });
    if (!response.ok) throw sourceHttpError(response, url);
    return (await response.json()) as unknown;
  });

export const fetchText = async (
  fetcher: typeof fetch,
  url: string,
  signal?: AbortSignal,
): Promise<string> =>
  withTransientRetry(async () => {
    const response = await fetcher(url, {
      headers: { accept: 'application/xml', 'user-agent': 'Watcher/1.0' },
      signal: signalFor(signal),
    });
    if (!response.ok) throw sourceHttpError(response, url);
    return response.text();
  });
