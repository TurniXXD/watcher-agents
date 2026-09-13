import { retryTransient, sourceHttpError } from '@watcher/core';

const signalFor = (signal?: AbortSignal): AbortSignal =>
  signal
    ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
    : AbortSignal.timeout(30_000);

export const fetchJson = async (
  fetcher: typeof fetch,
  url: string,
  signal?: AbortSignal,
): Promise<unknown> =>
  retryTransient(
    async () => {
      const response = await fetcher(url, {
        headers: { accept: 'application/json', 'user-agent': 'Watcher/1.0' },
        signal: signalFor(signal),
      });
      if (!response.ok) throw sourceHttpError(response, url);
      try {
        const body = await response.text();
        if (!body.trim()) throw new SyntaxError('Empty response body');
        return JSON.parse(body) as unknown;
      } catch (error) {
        throw new Error(
          `Invalid JSON response from ${new URL(url).hostname}; response body was empty, malformed, or truncated`,
          { cause: error },
        );
      }
    },
    signal ? { signal } : {},
  );

export const fetchText = async (
  fetcher: typeof fetch,
  url: string,
  signal?: AbortSignal,
): Promise<string> =>
  retryTransient(
    async () => {
      const response = await fetcher(url, {
        headers: { accept: 'application/xml', 'user-agent': 'Watcher/1.0' },
        signal: signalFor(signal),
      });
      if (!response.ok) throw sourceHttpError(response, url);
      return response.text();
    },
    signal ? { signal } : {},
  );
