import type { z } from 'zod';
import { sourceHttpError } from '@watcher/core';

type OfficialJsonRequest = {
  method?: 'GET' | 'POST';
  body?: Record<string, unknown>;
  notFound?: 'error' | 'null';
};

const requestOfficialJson = async <T>(
  url: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
  fetcher: typeof fetch,
  request: OfficialJsonRequest,
): Promise<T | null> => {
  const method = request.method ?? 'GET';
  const response = await fetcher(url, {
    method,
    redirect: 'error',
    headers: {
      accept: 'application/json',
      'user-agent': 'Watcher OSINT/1.0 (public research)',
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
    },
    ...(request.body ? { body: JSON.stringify(request.body) } : {}),
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  if (response.status === 404 && request.notFound === 'null') return null;
  if (!response.ok) throw sourceHttpError(response, url);
  const length = Number(response.headers.get('content-length') ?? '0');
  if (length > 2_000_000)
    throw new Error('Official source exceeded response size limit');
  if (!response.body) throw new Error('Official source returned an empty body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > 2_000_000)
        throw new Error('Official source exceeded response size limit');
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
  return schema.parse(JSON.parse(new TextDecoder().decode(bytes)));
};

export const fetchOfficialJson = async <T>(
  url: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<T> => {
  // Only fixed, reviewed official endpoints call this helper; never use it with a user URL.
  const result = await requestOfficialJson(url, schema, signal, fetcher, {});
  if (result === null) throw new Error('Official source unexpectedly missing');
  return result;
};

export const postOfficialJson = async <T>(
  url: string,
  body: Record<string, unknown>,
  schema: z.ZodType<T>,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<T> => {
  // Only fixed, reviewed official endpoints call this helper; never use it with a user URL.
  const result = await requestOfficialJson(url, schema, signal, fetcher, {
    method: 'POST',
    body,
  });
  if (result === null) throw new Error('Official source unexpectedly missing');
  return result;
};

export const fetchOptionalOfficialJson = <T>(
  url: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<T | null> =>
  requestOfficialJson(url, schema, signal, fetcher, { notFound: 'null' });
