import {
  assertPublicHttpUrlResolved,
  retryTransient,
  sourceHttpError,
} from '@watcher/core';

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
  return retryTransient(
    async () => {
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
        const reader = response.body?.getReader();
        if (!reader) return { html: '', url };
        const chunks: Uint8Array[] = [];
        let total = 0;
        try {
          while (total < maximumBytes) {
            const part = await reader.read();
            if (part.done) break;
            const bounded = part.value.subarray(0, maximumBytes - total);
            chunks.push(bounded);
            total += bounded.byteLength;
            if (bounded.byteLength < part.value.byteLength) break;
          }
        } finally {
          await reader.cancel().catch(() => undefined);
        }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return { html: new TextDecoder().decode(bytes), url };
      }
      throw new Error('Public source exceeded the redirect limit');
    },
    options.signal ? { signal: options.signal } : {},
  );
};
