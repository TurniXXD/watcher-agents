import { sourceHttpError } from '@watcher/core';

export const fetchJson = async (
  fetcher: typeof fetch,
  url: string,
  signal?: AbortSignal,
): Promise<unknown> => {
  const response = await fetcher(url, {
    headers: { accept: 'application/json', 'user-agent': 'Watcher/1.0' },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw sourceHttpError(response, url);
  return response.json();
};

export const fetchText = async (
  fetcher: typeof fetch,
  url: string,
  signal?: AbortSignal,
): Promise<string> => {
  const response = await fetcher(url, {
    headers: { accept: 'application/xml', 'user-agent': 'Watcher/1.0' },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw sourceHttpError(response, url);
  return response.text();
};
