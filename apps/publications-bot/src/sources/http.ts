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
  if (!response.ok)
    throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
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
  if (!response.ok)
    throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
  return response.text();
};
