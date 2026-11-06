import { asText } from '../lib/equality';
import { randomUUID } from 'node:crypto';
import type { Endpoint, Payload, PayloadRequest } from 'payload';
import type { IngestibleCollection } from '../collections/ingestion';
import { loadEnv } from '../env';
import {
  clientKey,
  errorResponse,
  jsonResponse,
  zodDetails,
} from '../lib/http';
import { TokenBucketLimiter } from '../lib/rate-limit';
import { ingestAdapters } from './adapters';
import {
  checkCredential,
  parseBearerToken,
  type CredentialRecord,
} from './credentials';
import { ingestBatchEnvelopeSchema } from './schemas';
import { IngestConflictError, IngestionService } from './service';

export const INGEST_PREFIX = '/ingest/v1';
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{8,128}$/u;
const LAST_USED_INTERVAL_MS = 5 * 60_000;

const services = new WeakMap<Payload, IngestionService>();
export const ingestionService = (payload: Payload): IngestionService => {
  let service = services.get(payload);
  if (!service) {
    service = new IngestionService(payload);
    services.set(payload, service);
  }
  return service;
};

let limiters:
  | { perCredential: TokenBucketLimiter; authFailures: TokenBucketLimiter }
  | undefined;
const rateLimiters = () =>
  (limiters ??= {
    perCredential: new TokenBucketLimiter(
      loadEnv().INGEST_RATE_LIMIT_PER_MINUTE,
    ),
    authFailures: new TokenBucketLimiter(20),
  });

type Authenticated = { credential: CredentialRecord; requestId: string };

/** Machine-to-machine authentication with per-bot hashed credentials and scopes. */
export const authenticateBot = async (
  req: PayloadRequest,
  scope: string | null,
  requestId: string,
): Promise<Authenticated | Response> => {
  const env = loadEnv();
  const ip = clientKey(req.headers, env.TRUST_PROXY_HEADERS);
  const headers = { 'X-Request-Id': requestId };
  const unauthorized = (reason: string, status: 401 | 403 = 401) => {
    rateLimiters().authFailures.consume(ip);
    req.payload.logger.warn(
      { audit: 'ingestion-auth', reason, requestId },
      'Rejected ingestion credential',
    );
    return errorResponse(
      status,
      status === 401 ? 'unauthorized' : 'forbidden',
      status === 401
        ? 'Invalid or missing bot credential'
        : 'Credential lacks the required scope',
      {
        headers:
          status === 401
            ? { ...headers, 'WWW-Authenticate': 'Bearer realm="ingest"' }
            : headers,
        requestId,
      },
    );
  };
  if (rateLimiters().authFailures.consume(ip, 0).remaining < 1) {
    return errorResponse(
      429,
      'rate_limited',
      'Too many failed authentication attempts',
      {
        headers: { ...headers, 'Retry-After': '60' },
        requestId,
      },
    );
  }
  const token = parseBearerToken(req.headers.get('authorization'));
  if (!token) return unauthorized('missing_or_malformed');
  const found = await req.payload.find({
    collection: 'ingestion-clients',
    where: { keyId: { equals: token.keyId } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    showHiddenFields: true,
  });
  const record = (found.docs[0] as CredentialRecord | undefined) ?? null;
  const check = checkCredential(
    token,
    record,
    scope ?? record?.scopes?.[0] ?? '',
  );
  if (!check.ok) return unauthorized(check.reason, check.status);
  const decision = rateLimiters().perCredential.consume(check.credential.keyId);
  if (!decision.allowed) {
    return errorResponse(429, 'rate_limited', 'Rate limit exceeded', {
      headers: {
        ...headers,
        'Retry-After': String(decision.retryAfterSeconds),
      },
      requestId,
    });
  }
  const lastUsed = (record as { lastUsedAt?: string | null }).lastUsedAt;
  if (
    !lastUsed ||
    Date.now() - new Date(lastUsed).getTime() > LAST_USED_INTERVAL_MS
  ) {
    await req.payload.update({
      collection: 'ingestion-clients',
      id: check.credential.id,
      data: { lastUsedAt: new Date().toISOString() },
      overrideAccess: true,
      depth: 0,
    });
  }
  return { credential: check.credential, requestId };
};

const readJsonBody = async (
  req: PayloadRequest,
  maxBytes: number,
): Promise<unknown> => {
  const contentType = req.headers.get('content-type') ?? '';
  if (!/^application\/json\b/iu.test(contentType)) {
    throw Object.assign(new Error('Content-Type must be application/json'), {
      status: 415 as const,
    });
  }
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxBytes)
    throw Object.assign(new Error('Request body too large'), {
      status: 413 as const,
    });
  const text = (await req.text?.()) ?? '';
  if (Buffer.byteLength(text, 'utf8') > maxBytes)
    throw Object.assign(new Error('Request body too large'), {
      status: 413 as const,
    });
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw Object.assign(new Error('Malformed JSON'), { status: 400 as const });
  }
};

const ingestHandler =
  (collection: IngestibleCollection): Endpoint['handler'] =>
  async (req) => {
    const env = loadEnv();
    const requestId = randomUUID();
    const auth = await authenticateBot(req, collection, requestId);
    if (auth instanceof Response) return auth;
    const headers = { 'X-Request-Id': requestId };
    let body: unknown;
    try {
      body = await readJsonBody(req, env.INGEST_MAX_BODY_BYTES);
    } catch (error) {
      const status = (error as { status?: 400 | 413 | 415 }).status ?? 400;
      const code =
        status === 413
          ? 'payload_too_large'
          : status === 415
            ? 'unsupported_media_type'
            : 'bad_request';
      return errorResponse(status, code, (error as Error).message, {
        headers,
        requestId,
      });
    }
    const envelope = ingestBatchEnvelopeSchema.safeParse(body);
    if (!envelope.success) {
      return errorResponse(
        400,
        'validation_failed',
        'Body must be {"items": [...]}',
        {
          details: zodDetails(envelope.error.issues),
          headers,
          requestId,
        },
      );
    }
    if (envelope.data.items.length > env.INGEST_MAX_BATCH_SIZE) {
      return errorResponse(
        413,
        'payload_too_large',
        `At most ${env.INGEST_MAX_BATCH_SIZE} items per request`,
        { headers, requestId },
      );
    }
    const idempotencyKey = req.headers.get('idempotency-key') ?? undefined;
    if (idempotencyKey !== undefined && !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      return errorResponse(
        400,
        'bad_request',
        'Idempotency-Key must be 8-128 characters of [A-Za-z0-9_.:-]',
        { headers, requestId },
      );
    }
    try {
      const { run, replayed } = await ingestionService(req.payload).ingestBatch(
        ingestAdapters[collection],
        envelope.data.items,
        {
          botId: auth.credential.botId,
          credentialKeyId: auth.credential.keyId,
          requestId,
          ...(idempotencyKey ? { idempotencyKey } : {}),
        },
      );
      return jsonResponse(run, {
        status: run.status === 'failed' ? 422 : 200,
        headers: {
          ...headers,
          ...(replayed ? { 'Idempotent-Replayed': 'true' } : {}),
        },
      });
    } catch (error) {
      if (error instanceof IngestConflictError)
        return errorResponse(409, 'conflict', error.message, {
          headers,
          requestId,
        });
      req.payload.logger.error(
        {
          err: error instanceof Error ? error.message : String(error),
          requestId,
        },
        'Ingestion request failed',
      );
      return errorResponse(500, 'internal_error', 'Internal server error', {
        headers,
        requestId,
      });
    }
  };

const getRun: Endpoint['handler'] = async (req) => {
  const requestId = randomUUID();
  const auth = await authenticateBot(req, null, requestId);
  if (auth instanceof Response) return auth;
  const id = asText(req.routeParams?.id);
  if (!/^[0-9a-f-]{36}$/iu.test(id))
    return errorResponse(404, 'not_found', 'Run not found', { requestId });
  const run = await ingestionService(req.payload).findRun(
    id,
    auth.credential.botId,
  );
  return run
    ? jsonResponse(run, { headers: { 'X-Request-Id': requestId } })
    : errorResponse(404, 'not_found', 'Run not found', { requestId });
};

export const ingestEndpoints: Endpoint[] = [
  {
    path: `${INGEST_PREFIX}/events`,
    method: 'post',
    handler: ingestHandler('events'),
  },
  {
    path: `${INGEST_PREFIX}/articles`,
    method: 'post',
    handler: ingestHandler('articles'),
  },
  {
    path: `${INGEST_PREFIX}/news`,
    method: 'post',
    handler: ingestHandler('news'),
  },
  {
    path: `${INGEST_PREFIX}/publications`,
    method: 'post',
    handler: ingestHandler('publications'),
  },
  {
    path: `${INGEST_PREFIX}/social-posts`,
    method: 'post',
    handler: ingestHandler('social-posts'),
  },
  { path: `${INGEST_PREFIX}/runs/:id`, method: 'get', handler: getRun },
];
