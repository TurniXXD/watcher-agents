import {
  assertPublicHttpUrlResolved,
  retryTransient,
  sourceHttpError,
} from '@watcher/core';
import type { z } from 'zod';

export type PublicJsonOptions = {
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  maximumBytes?: number;
  maximumRedirects?: number;
  userAgent?: string;
  accept?: string;
  resolvePublicUrl?: typeof assertPublicHttpUrlResolved;
};

export const fetchPublicJson = async <T>(
  initialUrl: string,
  schema: z.ZodType<T>,
  options: PublicJsonOptions = {},
): Promise<{ data: T; url: string }> => {
  const fetcher = options.fetcher ?? fetch;
  const resolvePublicUrl =
    options.resolvePublicUrl ?? assertPublicHttpUrlResolved;
  const maximumRedirects = options.maximumRedirects ?? 5;
  const maximumBytes = options.maximumBytes ?? 2_000_000;
  const timeoutMs = options.timeoutMs ?? 20_000;
  return retryTransient(
    async () => {
      let url = (await resolvePublicUrl(initialUrl)).toString();
      for (let redirects = 0; redirects <= maximumRedirects; redirects += 1) {
        const response = await fetcher(url, {
          headers: {
            accept: options.accept ?? 'application/json, application/rdap+json',
            'user-agent':
              options.userAgent ?? 'Watcher OSINT/1.0 (public research)',
          },
          redirect: 'manual',
          signal: options.signal
            ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
            : AbortSignal.timeout(timeoutMs),
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location)
            throw new Error('Public JSON redirect omitted its destination');
          url = (
            await resolvePublicUrl(new URL(location, url).toString())
          ).toString();
          continue;
        }
        if (!response.ok) throw sourceHttpError(response, url);
        const length = Number(response.headers.get('content-length') ?? '0');
        if (length > maximumBytes)
          throw new Error('Public JSON source exceeded response size limit');
        if (!response.body)
          throw new Error('Public JSON source returned an empty body');
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            total += part.value.byteLength;
            if (total > maximumBytes)
              throw new Error(
                'Public JSON source exceeded response size limit',
              );
            chunks.push(part.value);
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
        return {
          data: schema.parse(JSON.parse(new TextDecoder().decode(bytes))),
          url,
        };
      }
      throw new Error('Public JSON source exceeded the redirect limit');
    },
    options.signal ? { signal: options.signal } : {},
  );
};
