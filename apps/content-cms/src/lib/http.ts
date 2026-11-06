import { createHash } from 'node:crypto';

export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

export type ApiErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'method_not_allowed'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'rate_limited'
  | 'conflict'
  | 'unavailable'
  | 'internal_error';

export type ApiError = {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId?: string;
    details?: Array<{ path: string; message: string }>;
  };
};

type JsonOptions = {
  status?: number;
  headers?: Record<string, string>;
  /** Shared-cache lifetime; omitted responses are `no-store`. */
  cacheSeconds?: number;
  request?: Request;
};

const cacheControl = (seconds?: number): string =>
  seconds === undefined
    ? 'no-store'
    : `public, max-age=60, s-maxage=${seconds}, stale-while-revalidate=${seconds * 2}`;

export const jsonResponse = (
  body: unknown,
  options: JsonOptions = {},
): Response => {
  const payload = JSON.stringify(body);
  const headers = new Headers({
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cacheControl(options.cacheSeconds),
    ...options.headers,
  });
  const status = options.status ?? 200;
  if (status === 200 && options.cacheSeconds !== undefined) {
    const etag = `W/"${createHash('sha1').update(payload).digest('base64url')}"`;
    headers.set('ETag', etag);
    headers.set('Vary', 'Origin');
    const match = options.request?.headers.get('if-none-match');
    if (match && match.split(',').some((tag) => tag.trim() === etag)) {
      return new Response(null, { status: 304, headers });
    }
  }
  return new Response(payload, { status, headers });
};

export const errorResponse = (
  status: number,
  code: ApiErrorCode,
  message: string,
  extra: {
    details?: ApiError['error']['details'];
    headers?: Record<string, string>;
    requestId?: string;
  } = {},
): Response =>
  jsonResponse(
    {
      error: {
        code,
        message,
        ...(extra.requestId ? { requestId: extra.requestId } : {}),
        ...(extra.details ? { details: extra.details } : {}),
      },
    } satisfies ApiError,
    { status, ...(extra.headers ? { headers: extra.headers } : {}) },
  );

export const zodDetails = (
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): NonNullable<ApiError['error']['details']> =>
  issues.slice(0, 50).map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));

/**
 * Client identity for rate limiting. Proxy headers are honoured only when the
 * deployment declares that a trusted proxy (cloudflared) sets them.
 */
export const clientKey = (headers: Headers, trustProxy: boolean): string => {
  if (trustProxy) {
    const forwarded =
      headers.get('cf-connecting-ip') ??
      headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      headers.get('x-real-ip');
    if (forwarded) return forwarded.slice(0, 64);
  }
  return 'direct';
};

export const htmlResponse = (html: string, csp: string): Response =>
  new Response(html, {
    status: 200,
    headers: {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Content-Security-Policy': csp,
    },
  });
