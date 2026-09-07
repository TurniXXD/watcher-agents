import { assertPublicHttpUrlResolved, sourceHttpError } from '@watcher/core';

export type PublicHtmlFetchOptions = {
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  maximumBytes?: number;
  maximumRedirects?: number;
  userAgent?: string;
  resolvePublicUrl?: typeof assertPublicHttpUrlResolved;
};

export type PublicHtmlResponse = {
  html: string;
  url: string;
};

export const fetchPublicHtml = async (
  initialUrl: string,
  options: PublicHtmlFetchOptions = {},
): Promise<PublicHtmlResponse> => {
  const fetcher = options.fetcher ?? fetch;
  const resolvePublicUrl =
    options.resolvePublicUrl ?? assertPublicHttpUrlResolved;
  const maximumRedirects = options.maximumRedirects ?? 5;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maximumBytes = options.maximumBytes ?? 2_000_000;
  let url = (await resolvePublicUrl(initialUrl)).toString();

  for (let redirects = 0; redirects <= maximumRedirects; redirects += 1) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const response = await fetcher(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent':
          options.userAgent ?? 'Watcher/1.0 (+public-source-fetcher)',
      },
      redirect: 'manual',
      signal: options.signal
        ? AbortSignal.any([options.signal, timeout])
        : timeout,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location)
        throw new Error('Public source redirect omitted its destination');
      url = (
        await resolvePublicUrl(new URL(location, url).toString())
      ).toString();
      continue;
    }
    if (!response.ok) throw sourceHttpError(response, url);
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('html'))
      throw new Error(`Expected HTML from ${url}`);
    return { html: (await response.text()).slice(0, maximumBytes), url };
  }
  throw new Error('Public source exceeded the redirect limit');
};
