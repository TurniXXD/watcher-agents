import { z } from 'zod';
import {
  articleIngestItemSchema,
  eventIngestItemSchema,
  ingestRunSchema,
  newsIngestItemSchema,
  publicationIngestItemSchema,
  socialPostIngestItemSchema,
} from '../ingestion/schemas';
import {
  categoriesQuerySchema,
  categoriesResponseSchema,
  contentListQuerySchema,
  detailResponseSchema,
  errorResponseSchema,
  eventsQuerySchema,
  listResponseSchema,
  publicArticleDetailSchema,
  publicArticleSchema,
  publicEventSchema,
  publicNewsSchema,
  publicPublicationSchema,
} from '../public-api/schemas';

export const API_TITLE = 'Vantuch Content API';
export const API_VERSION = '1.0.0';

type JsonSchema = Record<string, unknown>;
type Components = Record<string, JsonSchema>;

const DEFS_REF = /^#\/\$defs\//u;

const rewriteRefs = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(rewriteRefs);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as JsonSchema)
      .filter(([key]) => key !== '$schema' && key !== 'id')
      .map(([key, entry]) => [
        key,
        key === '$ref' && typeof entry === 'string'
          ? entry.replace(DEFS_REF, '#/components/schemas/')
          : rewriteRefs(entry),
      ]),
  );
};

/**
 * Converts a Zod schema to an OpenAPI 3.1 (JSON Schema 2020-12) schema. Nested
 * schemas with a `meta({ id })` are hoisted to `components.schemas`, so the
 * documentation is generated from the same schemas used for runtime validation.
 */
const toSchema = (
  schema: z.ZodType,
  io: 'input' | 'output',
  components: Components,
): JsonSchema => {
  const json = z.toJSONSchema(schema, {
    io,
    target: 'draft-2020-12',
    unrepresentable: 'any',
  }) as JsonSchema & {
    $defs?: Record<string, JsonSchema>;
  };
  const { $defs, ...root } = json;
  for (const [name, definition] of Object.entries($defs ?? {})) {
    components[name] ??= rewriteRefs(definition) as JsonSchema;
  }
  return rewriteRefs(root) as JsonSchema;
};

const component = (
  name: string,
  schema: z.ZodType,
  io: 'input' | 'output',
  components: Components,
) => {
  const ref = `#/components/schemas/${name}`;
  if (!components[name]) {
    // Schemas with `meta({ id })` come back as a $ref to their hoisted definition.
    const root = toSchema(schema, io, components);
    if (root.$ref !== ref) components[name] ??= root;
  }
  return { $ref: ref };
};

const queryParameters = (schema: z.ZodObject, components: Components) =>
  Object.entries(schema.shape).map(([name, field]) => {
    const json = toSchema(field as z.ZodType, 'input', components);
    const { description, ...rest } = json;
    const optional = (field as z.ZodType).safeParse(undefined).success;
    return {
      name,
      in: 'query',
      required: !optional,
      ...(typeof description === 'string' ? { description } : {}),
      schema: rest,
    };
  });

const errorResponses = (components: Components, codes: number[]) => {
  const descriptions: Record<number, string> = {
    400: 'Invalid request or query parameters',
    401: 'Missing or invalid bot credential',
    403: 'Credential lacks the required scope',
    404: 'Not found (also returned for unpublished content)',
    409: 'Idempotency-Key conflict',
    413: 'Request body or batch too large',
    415: 'Content-Type must be application/json',
    422: 'Every item in the batch failed validation',
    429: 'Rate limit exceeded; see Retry-After',
    500: 'Internal error (details are never exposed)',
  };
  return Object.fromEntries(
    codes.map((code) => [
      String(code),
      {
        description: descriptions[code] ?? 'Error',
        content: {
          'application/json': {
            schema:
              code === 422
                ? { $ref: '#/components/schemas/IngestRun' }
                : component('Error', errorResponseSchema, 'output', components),
          },
        },
      },
    ]),
  );
};

const exampleEvent = {
  id: '0f8e2a52-7d2c-4c55-9e85-3b7f1f0a9c11',
  slug: 'example-ai-meetup-2026-11-20',
  title: 'Example AI meetup',
  summary: 'An example listing used in documentation.',
  description: null,
  startsAt: '2026-11-20T17:00:00.000Z',
  endsAt: '2026-11-20T19:00:00.000Z',
  timezone: 'Europe/Prague',
  city: 'Brno',
  venueName: 'Example venue',
  address: null,
  category: 'ai',
  tags: ['meetup'],
  organizerName: 'Example organiser',
  sourceUrl: 'https://example.com/events/ai-meetup',
  registrationUrl: null,
  imageUrl: null,
  isFree: true,
  price: 0,
  currency: null,
  freeFood: 'yes',
  foodDetails: 'Free pizza after the talks',
  status: 'scheduled',
  featured: false,
  lastVerifiedAt: '2026-11-06T08:00:00.000Z',
  updatedAt: '2026-11-06T08:00:00.000Z',
};

const cacheHeader = (seconds: number) => ({
  'Cache-Control': {
    description: `Shared caches may keep the response for ${seconds} seconds.`,
    schema: {
      type: 'string',
      example: `public, max-age=60, s-maxage=${seconds}, stale-while-revalidate=${seconds * 2}`,
    },
  },
  ETag: {
    description: 'Weak validator; send If-None-Match for 304 responses.',
    schema: { type: 'string' },
  },
});

export const buildPublicOpenApi = (serverUrl: string) => {
  const components: Components = {};
  const ok = (
    name: string,
    schema: z.ZodType,
    seconds: number,
    example?: unknown,
  ) => ({
    description: 'OK',
    headers: cacheHeader(seconds),
    content: {
      'application/json': {
        schema: component(name, schema, 'output', components),
        ...(example ? { example } : {}),
      },
    },
  });
  const eventList = listResponseSchema(publicEventSchema, 'PublicEventList');
  const listOf = (name: string, item: z.ZodType) =>
    listResponseSchema(item, name);
  const slugParameter = {
    name: 'slug',
    in: 'path',
    required: true,
    schema: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
  };
  const eventListOperation = (
    summary: string,
    operationId: string,
    description: string,
  ) => ({
    get: {
      tags: ['Events'],
      summary,
      operationId,
      description,
      security: [],
      parameters: queryParameters(eventsQuerySchema, components),
      responses: {
        200: ok('PublicEventList', eventList, 300, {
          data: [exampleEvent],
          nextCursor: null,
          meta: { limit: 20 },
        }),
        ...errorResponses(components, [400, 429, 500]),
      },
    },
  });
  return {
    openapi: '3.1.0',
    info: {
      title: API_TITLE,
      version: API_VERSION,
      description:
        'Read-only public content API for vantuch.dev. Only approved, published content is returned. Lists use deterministic cursor pagination: pass `nextCursor` as `cursor` until it is null. All timestamps are ISO 8601 in UTC; date-only filters are calendar days in Europe/Prague.',
    },
    servers: [{ url: `${serverUrl.replace(/\/$/u, '')}/api` }],
    tags: [
      { name: 'Events' },
      { name: 'Articles' },
      { name: 'News' },
      { name: 'Publications' },
    ],
    paths: {
      '/public/v1/events': eventListOperation(
        'List upcoming events',
        'listEvents',
        'Defaults: city=brno, nearest upcoming first (including events still running), limit 20 (max 100). `freeFood=true` returns only events whose source explicitly confirms free food.',
      ),
      '/public/v1/events/featured': eventListOperation(
        'List featured events',
        'listFeaturedEvents',
        'Same filters as /events with featured=true.',
      ),
      '/public/v1/events/categories': {
        get: {
          tags: ['Events'],
          summary: 'List categories of upcoming public events',
          operationId: 'listEventCategories',
          security: [],
          parameters: queryParameters(categoriesQuerySchema, components),
          responses: {
            200: ok('EventCategoriesResponse', categoriesResponseSchema, 3600, {
              data: [{ slug: 'ai', label: 'Ai' }],
              meta: { city: 'brno' },
            }),
            ...errorResponses(components, [400, 429, 500]),
          },
        },
      },
      '/public/v1/events/{slug}': {
        get: {
          tags: ['Events'],
          summary: 'Get an event by slug',
          operationId: 'getEvent',
          description:
            'Archived events remain reachable by slug but leave listings.',
          security: [],
          parameters: [slugParameter],
          responses: {
            200: ok(
              'PublicEventDetail',
              detailResponseSchema(publicEventSchema, 'PublicEventDetail'),
              900,
              { data: exampleEvent },
            ),
            ...errorResponses(components, [404, 429, 500]),
          },
        },
      },
      '/public/v1/articles': {
        get: {
          tags: ['Articles'],
          summary: 'List articles (newest first)',
          operationId: 'listArticles',
          security: [],
          parameters: queryParameters(contentListQuerySchema, components),
          responses: {
            200: ok(
              'PublicArticleList',
              listOf('PublicArticleList', publicArticleSchema),
              300,
            ),
            ...errorResponses(components, [400, 429, 500]),
          },
        },
      },
      '/public/v1/articles/{slug}': {
        get: {
          tags: ['Articles'],
          summary: 'Get an article by slug',
          operationId: 'getArticle',
          security: [],
          parameters: [slugParameter],
          responses: {
            200: ok(
              'PublicArticleDetailResponse',
              detailResponseSchema(
                publicArticleDetailSchema,
                'PublicArticleDetailResponse',
              ),
              900,
            ),
            ...errorResponses(components, [404, 429, 500]),
          },
        },
      },
      '/public/v1/news': {
        get: {
          tags: ['News'],
          summary: 'List news (newest first)',
          operationId: 'listNews',
          security: [],
          parameters: queryParameters(contentListQuerySchema, components),
          responses: {
            200: ok(
              'PublicNewsList',
              listOf('PublicNewsList', publicNewsSchema),
              300,
            ),
            ...errorResponses(components, [400, 429, 500]),
          },
        },
      },
      '/public/v1/publications': {
        get: {
          tags: ['Publications'],
          summary: 'List publications (newest first)',
          operationId: 'listPublications',
          description:
            '`tag` filters by research topic; `category` is ignored.',
          security: [],
          parameters: queryParameters(contentListQuerySchema, components),
          responses: {
            200: ok(
              'PublicPublicationList',
              listOf('PublicPublicationList', publicPublicationSchema),
              300,
            ),
            ...errorResponses(components, [400, 429, 500]),
          },
        },
      },
    },
    components: { schemas: components },
  };
};

export const buildIngestOpenApi = (serverUrl: string) => {
  const components: Components = {};
  const batch = (name: string, item: z.ZodType) =>
    component(
      name,
      z.object({ items: z.array(item).min(1).max(100) }),
      'input',
      components,
    );
  const run = () =>
    component('IngestRun', ingestRunSchema, 'output', components);
  const ingestOperation = (
    tag: string,
    operationId: string,
    item: z.ZodType,
    batchName: string,
    example: unknown,
  ) => ({
    post: {
      tags: [tag],
      operationId,
      summary: `Upsert ${tag.toLowerCase()} (batch)`,
      description:
        'Idempotent upsert keyed by (collection, bot, externalId). New records start unpublished with review status Ingested. Changes to reviewed, published, or human-edited records become pending updates instead of overwriting them. Items are validated individually; see `results`.',
      parameters: [
        {
          name: 'Idempotency-Key',
          in: 'header',
          required: false,
          description:
            'Retry-safe request key (8–128 chars). Replays return the stored run with `Idempotent-Replayed: true`.',
          schema: { type: 'string', pattern: '^[A-Za-z0-9_.:-]{8,128}$' },
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: batch(batchName, item), example },
        },
      },
      responses: {
        200: {
          description: 'Batch processed (status succeeded or partial)',
          content: { 'application/json': { schema: run() } },
        },
        ...errorResponses(
          components,
          [400, 401, 403, 409, 413, 415, 422, 429, 500],
        ),
      },
    },
  });
  return {
    openapi: '3.1.0',
    info: {
      title: API_TITLE,
      version: API_VERSION,
      description:
        'Authenticated bot ingestion API. Each bot uses its own credential (`Authorization: Bearer vch_<keyId>_<secret>`) with per-collection scopes. Credentials can never publish content.',
    },
    servers: [{ url: `${serverUrl.replace(/\/$/u, '')}/api` }],
    security: [{ botToken: [] }],
    tags: [
      { name: 'Events' },
      { name: 'Articles' },
      { name: 'News' },
      { name: 'Publications' },
      { name: 'Social posts' },
      { name: 'Runs' },
    ],
    paths: {
      '/ingest/v1/events': ingestOperation(
        'Events',
        'ingestEvents',
        eventIngestItemSchema,
        'EventIngestBatch',
        {
          items: [
            {
              externalId:
                'brno-events-agent:0f8e2a52-7d2c-4c55-9e85-3b7f1f0a9c11',
              title: 'Example AI meetup',
              summary:
                'Ai meetup at Example venue, organised by Example organiser.',
              startsAt: '2026-11-20T18:00:00+01:00',
              endsAt: '2026-11-20T20:00:00+01:00',
              city: 'Brno',
              venueName: 'Example venue',
              category: 'ai',
              tags: ['meetup'],
              sourceUrl: 'https://example.com/events/ai-meetup',
              isFree: true,
              freeFood: 'yes',
              foodDetails: 'Free pizza',
              foodEvidence: [
                { text: 'Free pizza and drinks after the talks.' },
              ],
              sourceReferences: [
                {
                  title: 'Example listing',
                  url: 'https://example.com/events/ai-meetup',
                },
              ],
            },
          ],
        },
      ),
      '/ingest/v1/articles': ingestOperation(
        'Articles',
        'ingestArticles',
        articleIngestItemSchema,
        'ArticleIngestBatch',
        {
          items: [
            {
              externalId: 'article-1',
              title: 'Example article',
              excerpt: 'Short excerpt.',
            },
          ],
        },
      ),
      '/ingest/v1/news': ingestOperation(
        'News',
        'ingestNews',
        newsIngestItemSchema,
        'NewsIngestBatch',
        {
          items: [
            {
              externalId: 'news-1',
              title: 'Example news',
              originalUrl: 'https://example.com/news/1',
            },
          ],
        },
      ),
      '/ingest/v1/publications': ingestOperation(
        'Publications',
        'ingestPublications',
        publicationIngestItemSchema,
        'PublicationIngestBatch',
        {
          items: [
            {
              externalId: 'pmid:1',
              title: 'Example publication',
              doi: '10.1000/example',
            },
          ],
        },
      ),
      '/ingest/v1/social-posts': ingestOperation(
        'Social posts',
        'ingestSocialPosts',
        socialPostIngestItemSchema,
        'SocialPostIngestBatch',
        {
          items: [
            {
              externalId: 'post-1',
              title: 'Example post',
              content: 'Example',
              platform: 'linkedin',
              postType: 'post',
            },
          ],
        },
      ),
      '/ingest/v1/runs/{id}': {
        get: {
          tags: ['Runs'],
          operationId: 'getIngestRun',
          summary: 'Get an ingestion run created by the calling bot',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          responses: {
            200: {
              description: 'OK',
              content: { 'application/json': { schema: run() } },
            },
            ...errorResponses(components, [401, 404, 429]),
          },
        },
      },
    },
    components: {
      schemas: components,
      securitySchemes: {
        botToken: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'vch_<keyId>_<secret>',
          description:
            'Per-bot credential created with `pnpm --filter @watcher/content-cms credentials:create`.',
        },
      },
    },
  };
};
