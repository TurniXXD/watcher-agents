import { sourceHttpError } from '@watcher/core';
import { assertPublicHttpUrlResolved } from './network.js';

export const normalizeWhitespace = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();

export const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"');

export const htmlAttribute = (
  tag: string,
  name: string,
): string | undefined => {
  const match = tag.match(
    new RegExp(`${name}\\s*=\\s*(?:"([^"]+)"|'([^']+)')`, 'i'),
  );
  const value = match?.[1] ?? match?.[2];
  return value ? decodeHtmlEntities(value) : undefined;
};

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
  if (!response.ok) throw sourceHttpError(response, url);
  return response.text();
};

export const stripHtml = (html: string): string =>
  normalizeWhitespace(
    decodeHtmlEntities(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' '),
    ),
  );

export const fetchPublicText = async (
  fetcher: typeof fetch,
  initialUrl: string,
  signal?: AbortSignal,
  resolvePublicUrl: typeof assertPublicHttpUrlResolved = assertPublicHttpUrlResolved,
): Promise<string> => {
  let url = await resolvePublicUrl(initialUrl);

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
      url = await resolvePublicUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw sourceHttpError(response, url);
    return response.text();
  }

  throw new Error('Feed exceeded the redirect limit');
};
