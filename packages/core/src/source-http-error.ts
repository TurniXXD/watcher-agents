const retryAfterSeconds = /^\d+(?:\.\d+)?$/u;

export const parseRetryAfter = (
  value: string | null,
  now = new Date(),
): Date | undefined => {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (retryAfterSeconds.test(normalized)) {
    return new Date(now.getTime() + Number(normalized) * 1_000);
  }
  const timestamp = Date.parse(normalized);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp);
};

export class SourceHttpError extends Error {
  public override readonly name = 'SourceHttpError';

  public constructor(
    public readonly status: number,
    hostname: string,
    public readonly retryAt?: Date,
  ) {
    super(
      `HTTP ${status} from ${hostname}${retryAt ? `; retry after ${retryAt.toISOString()}` : ''}`,
    );
  }
}

export const sourceHttpError = (
  response: Response,
  url: string | URL,
  now = new Date(),
): SourceHttpError =>
  new SourceHttpError(
    response.status,
    new URL(url).hostname,
    parseRetryAfter(response.headers.get('retry-after'), now),
  );

export const sourceRetryAt = (error: unknown): Date | undefined =>
  error instanceof SourceHttpError
    ? error.retryAt
    : typeof error === 'object' &&
        error !== null &&
        'retryAt' in error &&
        error.retryAt instanceof Date
      ? error.retryAt
      : undefined;

export const isSourceRateLimited = (error: unknown): boolean =>
  (error instanceof SourceHttpError && error.status === 429) ||
  (error instanceof Error &&
    /\b429\b|rate[_ -]?limit|too many requests|requests more sparingly/i.test(
      error.message,
    ));
