import { assertPublicHttpUrlResolved } from '@watcher/core';

export const fetchText = async (
  fetcher: typeof fetch,
  url: string,
  headers: HeadersInit = {},
  signal?: AbortSignal,
): Promise<string> => {
  const response = await fetcher(url, {
    headers,
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
  return response.text();
};

export const stripHtml = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();

export const fetchPublicText = async (
  fetcher: typeof fetch,
  initialUrl: string,
  signal?: AbortSignal,
): Promise<string> => {
  let url = await assertPublicHttpUrlResolved(initialUrl);

  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetcher(url, {
      headers: { accept: 'application/atom+xml,application/rss+xml' },
      redirect: 'manual',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Feed redirect omitted its destination');
      url = await assertPublicHttpUrlResolved(
        new URL(location, url).toString(),
      );
      continue;
    }
    if (!response.ok)
      throw new Error(`HTTP ${response.status} from ${url.hostname}`);
    return response.text();
  }

  throw new Error('Feed exceeded the redirect limit');
};
