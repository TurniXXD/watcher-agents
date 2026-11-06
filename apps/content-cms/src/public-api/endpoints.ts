import { asText } from '../lib/equality';
import { randomUUID } from 'node:crypto';
import type { Endpoint, Payload, PayloadRequest } from 'payload';
import type { z } from 'zod';
import { loadEnv } from '../env';
import { DEFAULT_CRITICAL_GRACE_HOURS } from '../globals/settings';
import {
  clientKey,
  errorResponse,
  jsonResponse,
  zodDetails,
} from '../lib/http';
import { TokenBucketLimiter } from '../lib/rate-limit';
import { slugify } from '../lib/slug';
import {
  toPublicArticle,
  toPublicArticleDetail,
  toPublicEvent,
  toPublicNews,
  toPublicPublication,
} from './dto';
import {
  buildContentWhere,
  buildEventsWhere,
  CONTENT_SORT,
  contentDetailWhere,
  eventDetailWhere,
  nextCursorFor,
  QueryInputError,
  sortClause,
} from './query';
import {
  categoriesQuerySchema,
  contentListQuerySchema,
  eventsQuerySchema,
} from './schemas';

export const PUBLIC_PREFIX = '/public/v1';
export const CACHE_SECONDS = {
  list: 300,
  detail: 900,
  categories: 3600,
} as const;

let limiter: TokenBucketLimiter | undefined;
const publicLimiter = () =>
  (limiter ??= new TokenBucketLimiter(
    loadEnv().PUBLIC_API_RATE_LIMIT_PER_MINUTE,
  ));

let graceCache: { hours: number; loadedAt: number } | undefined;
const graceHours = async (payload: Payload): Promise<number> => {
  if (graceCache && Date.now() - graceCache.loadedAt < 60_000)
    return graceCache.hours;
  const settings = (await payload.findGlobal({
    slug: 'settings',
    overrideAccess: true,
    depth: 0,
  })) as {
    criticalUpdateGraceHours?: number | null;
  };
  graceCache = {
    hours: settings.criticalUpdateGraceHours ?? DEFAULT_CRITICAL_GRACE_HOURS,
    loadedAt: Date.now(),
  };
  return graceCache.hours;
};

/** Browser CORS for the public API only: read-only, no credentials, configured origins. */
export const publicCorsHeaders = (
  origin: string | null,
): Record<string, string> => {
  const allowed = loadEnv().CORS_ORIGINS;
  return {
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type, If-None-Match',
    'Access-Control-Max-Age': '600',
    ...(origin && allowed.includes(origin)
      ? { 'Access-Control-Allow-Origin': origin }
      : { 'Access-Control-Allow-Origin': 'null' }),
  };
};

const searchParams = (req: PayloadRequest): Record<string, string> => {
  const url = new URL(req.url ?? 'http://localhost/');
  const params: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (key in params)
      throw new QueryInputError(`Repeated query parameter: ${key}`);
    params[key] = value;
  }
  return params;
};

type Handler = (
  req: PayloadRequest,
  context: { now: Date; serverUrl: string; requestId: string },
) => Promise<Response>;

/** Rate limiting, CORS, and error shielding shared by every public endpoint. */
export const publicHandler =
  (handler: Handler): Endpoint['handler'] =>
  async (req) => {
    const env = loadEnv();
    const requestId = randomUUID();
    const cors = {
      ...publicCorsHeaders(req.headers.get('origin')),
      'X-Request-Id': requestId,
    };
    const decision = publicLimiter().consume(
      clientKey(req.headers, env.TRUST_PROXY_HEADERS),
    );
    if (!decision.allowed) {
      return errorResponse(429, 'rate_limited', 'Too many requests', {
        headers: { ...cors, 'Retry-After': String(decision.retryAfterSeconds) },
        requestId,
      });
    }
    try {
      const response = await handler(req, {
        now: new Date(),
        serverUrl: env.SERVER_URL,
        requestId,
      });
      for (const [key, value] of Object.entries(cors))
        response.headers.set(key, value);
      return response;
    } catch (error) {
      if (error instanceof QueryInputError) {
        return errorResponse(400, 'bad_request', error.message, {
          headers: cors,
          requestId,
        });
      }
      req.payload.logger.error(
        {
          err: error instanceof Error ? error.message : String(error),
          requestId,
          url: req.url,
        },
        'Public API error',
      );
      return errorResponse(500, 'internal_error', 'Internal server error', {
        headers: cors,
        requestId,
      });
    }
  };

const parseQuery = <T extends z.ZodType>(
  schema: T,
  req: PayloadRequest,
): z.infer<T> | Response => {
  const parsed = schema.safeParse(searchParams(req));
  return parsed.success
    ? parsed.data
    : errorResponse(400, 'validation_failed', 'Invalid query parameters', {
        details: zodDetails(parsed.error.issues),
      });
};

const listEvents =
  (forceFeatured: boolean): Handler =>
  async (req, { now, serverUrl }) => {
    const query = parseQuery(eventsQuerySchema, req);
    if (query instanceof Response) return query;
    const effective = forceFeatured ? { ...query, featured: true } : query;
    const result = await req.payload.find({
      collection: 'events',
      where: buildEventsWhere(effective, now, await graceHours(req.payload)),
      sort: sortClause(effective.sort),
      limit: effective.limit + 1,
      pagination: false,
      depth: 1,
      overrideAccess: true,
    });
    const docs = result.docs as unknown as Record<string, unknown>[];
    const page = docs.slice(0, effective.limit);
    return jsonResponse(
      {
        data: page.map((doc) => toPublicEvent(doc, serverUrl)),
        nextCursor:
          docs.length > effective.limit
            ? nextCursorFor(effective.sort, page.at(-1))
            : null,
        meta: { limit: effective.limit },
      },
      { cacheSeconds: CACHE_SECONDS.list, request: req as unknown as Request },
    );
  };

const eventDetail: Handler = async (req, { now, serverUrl }) => {
  const slug = asText(req.routeParams?.slug);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug) || slug.length > 120) {
    return errorResponse(404, 'not_found', 'Event not found');
  }
  const result = await req.payload.find({
    collection: 'events',
    where: eventDetailWhere(slug, now, await graceHours(req.payload)),
    limit: 1,
    pagination: false,
    depth: 1,
    overrideAccess: true,
  });
  const doc = result.docs[0] as Record<string, unknown> | undefined;
  if (!doc) return errorResponse(404, 'not_found', 'Event not found');
  return jsonResponse(
    { data: toPublicEvent(doc, serverUrl) },
    { cacheSeconds: CACHE_SECONDS.detail, request: req as unknown as Request },
  );
};

const eventCategories: Handler = async (req, { now }) => {
  const query = parseQuery(categoriesQuerySchema, req);
  if (query instanceof Response) return query;
  const where = buildEventsWhere(
    { ...eventsQuerySchema.parse({}), city: query.city },
    now,
    await graceHours(req.payload),
  );
  const distinct = await req.payload.findDistinct({
    collection: 'events',
    field: 'category',
    where,
    sort: 'category',
    overrideAccess: true,
    limit: 500,
  });
  const slugs = (distinct.values as Array<{ category?: unknown }>)
    .map((value) => value.category)
    .filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
  return jsonResponse(
    {
      data: slugs.map((slug) => ({
        slug,
        label:
          slug.charAt(0).toUpperCase() + slug.slice(1).replaceAll('-', ' '),
      })),
      meta: {
        city: query.city.toLowerCase() === 'all' ? 'all' : slugify(query.city),
      },
    },
    {
      cacheSeconds: CACHE_SECONDS.categories,
      request: req as unknown as Request,
    },
  );
};

type ContentCollection = 'articles' | 'news' | 'publications';

const listContent =
  (
    collection: ContentCollection,
    fields: { search: string[]; category?: string; tag?: string },
    map: (doc: Record<string, unknown>, serverUrl: string) => unknown,
  ): Handler =>
  async (req, { now, serverUrl }) => {
    const query = parseQuery(contentListQuerySchema, req);
    if (query instanceof Response) return query;
    const result = await req.payload.find({
      collection,
      where: buildContentWhere(query, now, fields),
      sort: sortClause(CONTENT_SORT),
      limit: query.limit + 1,
      pagination: false,
      depth: 1,
      overrideAccess: true,
    });
    const docs = result.docs as unknown as Record<string, unknown>[];
    const page = docs.slice(0, query.limit);
    return jsonResponse(
      {
        data: page.map((doc) => map(doc, serverUrl)),
        nextCursor:
          docs.length > query.limit
            ? nextCursorFor(CONTENT_SORT, page.at(-1))
            : null,
        meta: { limit: query.limit },
      },
      { cacheSeconds: CACHE_SECONDS.list, request: req as unknown as Request },
    );
  };

const articleDetail: Handler = async (req, { now, serverUrl }) => {
  const slug = asText(req.routeParams?.slug);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug) || slug.length > 120) {
    return errorResponse(404, 'not_found', 'Article not found');
  }
  const result = await req.payload.find({
    collection: 'articles',
    where: contentDetailWhere(slug, now),
    limit: 1,
    pagination: false,
    depth: 1,
    overrideAccess: true,
  });
  const doc = result.docs[0] as Record<string, unknown> | undefined;
  if (!doc) return errorResponse(404, 'not_found', 'Article not found');
  return jsonResponse(
    { data: toPublicArticleDetail(doc, serverUrl) },
    { cacheSeconds: CACHE_SECONDS.detail, request: req as unknown as Request },
  );
};

const routes: Array<[string, Handler]> = [
  ['/events', listEvents(false)],
  ['/events/categories', eventCategories],
  ['/events/featured', listEvents(true)],
  ['/events/:slug', eventDetail],
  [
    '/articles',
    listContent(
      'articles',
      { search: ['title', 'excerpt'], category: 'categories', tag: 'tags' },
      toPublicArticle,
    ),
  ],
  ['/articles/:slug', articleDetail],
  [
    '/news',
    listContent(
      'news',
      { search: ['title', 'summary'], category: 'category', tag: 'tags' },
      (doc) => toPublicNews(doc),
    ),
  ],
  [
    '/publications',
    listContent(
      'publications',
      { search: ['title', 'aiSummary', 'journal'], tag: 'researchTopics' },
      (doc) => toPublicPublication(doc),
    ),
  ],
];

export const publicEndpoints: Endpoint[] = routes.flatMap(([path, handler]) => [
  {
    path: `${PUBLIC_PREFIX}${path}`,
    method: 'get',
    handler: publicHandler(handler),
  },
  {
    path: `${PUBLIC_PREFIX}${path}`,
    method: 'options',
    handler: (req) =>
      new Response(null, {
        status: 204,
        headers: publicCorsHeaders(req.headers.get('origin')),
      }),
  },
]);
