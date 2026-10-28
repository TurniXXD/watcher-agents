import { assertPublicHttpUrlResolved } from '@watcher/core';

export class JobSourceHttpError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'JobSourceHttpError';
  }
}

const retryAfterMilliseconds = (response: Response): number | undefined => {
  const value = response.headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(30_000, seconds * 1_000);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.min(30_000, Math.max(0, date - Date.now()));
};

const delay = (milliseconds: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        const reason: unknown = signal.reason;
        reject(
          reason instanceof Error
            ? reason
            : new Error('Job source request was aborted'),
        );
      },
      { once: true },
    );
  });

export const fetchJobSource = async (
  urlValue: string,
  input: {
    accept: string;
    checkpoint?: { etag?: string; lastModified?: string };
    signal?: AbortSignal;
    fetcher?: typeof fetch;
    attempts?: number;
    timeoutMs?: number;
  },
): Promise<Response> => {
  const url = await assertPublicHttpUrlResolved(urlValue);
  const attempts = input.attempts ?? 3;
  const headers = new Headers({
    accept: input.accept,
    'user-agent': 'Watcher Job Discovery/1.0 (+self-hosted personal search)',
  });
  if (input.checkpoint?.etag)
    headers.set('if-none-match', input.checkpoint.etag);
  if (input.checkpoint?.lastModified)
    headers.set('if-modified-since', input.checkpoint.lastModified);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const timeout = AbortSignal.timeout(input.timeoutMs ?? 30_000);
      const signal = input.signal
        ? AbortSignal.any([input.signal, timeout])
        : timeout;
      let currentUrl = url;
      let response: Response | undefined;
      for (let redirect = 0; redirect <= 5; redirect += 1) {
        response = await (input.fetcher ?? fetch)(currentUrl, {
          headers,
          signal,
          redirect: 'manual',
        });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get('location');
        if (!location || redirect === 5)
          throw new JobSourceHttpError(
            `Invalid redirect from ${currentUrl.hostname}`,
            response.status,
            false,
          );
        currentUrl = await assertPublicHttpUrlResolved(
          new URL(location, currentUrl).toString(),
        );
      }
      if (!response) throw new Error('Source returned no response');
      if (response.ok || response.status === 304) return response;
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === attempts) {
        throw new JobSourceHttpError(
          `HTTP ${response.status} from ${url.hostname}`,
          response.status,
          retryable,
        );
      }
      await delay(
        retryAfterMilliseconds(response) ?? 500 * 2 ** (attempt - 1),
        input.signal,
      );
    } catch (error) {
      if (error instanceof JobSourceHttpError) throw error;
      if (attempt === attempts || input.signal?.aborted) throw error;
      await delay(500 * 2 ** (attempt - 1), input.signal);
    }
  }
  throw new Error('Unreachable source retry state');
};

export type JobAvailability =
  'OPEN_CONFIRMED' | 'LISTED_UNVERIFIED' | 'CLOSED_CONFIRMED' | 'UNKNOWN';

export const verifyJobAvailability = async (
  url: string,
  fetcher?: typeof fetch,
): Promise<JobAvailability> => {
  try {
    const response = await fetchJobSource(url, {
      accept: 'text/html,application/xhtml+xml',
      ...(fetcher ? { fetcher } : {}),
      attempts: 1,
      timeoutMs: 10_000,
    });
    const text = (await response.text()).slice(0, 500_000);
    const finalUrl = response.url ? new URL(response.url) : undefined;
    if (
      (finalUrl?.hostname === 'job-boards.greenhouse.io' &&
        finalUrl.searchParams.get('error') === 'true') ||
      /job-boards\.greenhouse\.io\/[^"'<>?\s]+\?error=true\b/iu.test(text)
    )
      return 'CLOSED_CONFIRMED';
    if (
      /\b(?:position|role|vacancy|job)(?:\s+posting)?\b[^.!?\n]{0,100}\b(?:filled|closed|expired|no longer (?:available|open))\b|\bno longer accepting applications?\b|applications? (?:are )?closed|(?:nabídka|inzerát|pozice)[^.\n]{0,100}(?:již není (?:aktivní|aktuální|dostupná)|byla obsazena|expiroval[ao]?)/iu.test(
        text,
      )
    )
      return 'CLOSED_CONFIRMED';
    if (
      /\b(?:apply now|apply for (?:this|the) (?:job|position)|submit (?:your )?application|odpovědět na nabídku|reagovat na nabídku|mám zájem)\b/iu.test(
        text,
      )
    )
      return 'OPEN_CONFIRMED';
    return 'LISTED_UNVERIFIED';
  } catch (error) {
    if (
      error instanceof JobSourceHttpError &&
      (error.status === 404 || error.status === 410)
    )
      return 'CLOSED_CONFIRMED';
    return 'UNKNOWN';
  }
};

export const responseCheckpoint = (response: Response) => ({
  ...(response.headers.get('etag')
    ? { etag: response.headers.get('etag')! }
    : {}),
  ...(response.headers.get('last-modified')
    ? { lastModified: response.headers.get('last-modified')! }
    : {}),
});
