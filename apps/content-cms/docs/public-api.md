# Public API

Read-only REST API for vantuch.dev. Base URL: `https://cms.vantuch.dev/api/public/v1`.
OpenAPI 3.1: `/api/public/openapi.json`; Swagger UI: `/api/public/docs`. Both are
anonymous and must stay outside Cloudflare Access.

| Endpoint                 | Cache (s-maxage) | Notes                                        |
| ------------------------ | ---------------- | -------------------------------------------- |
| `GET /events`            | 300 s            | See [Events API](events-api.md)              |
| `GET /events/featured`   | 300 s            | Same filters, `featured=true` forced         |
| `GET /events/categories` | 3600 s           | Categories of upcoming visible events        |
| `GET /events/:slug`      | 900 s            | Includes archived events                     |
| `GET /articles`          | 300 s            | Newest first; `q`, `category`, `tag`         |
| `GET /articles/:slug`    | 900 s            | Adds `contentText`, Lexical `content`, `seo` |
| `GET /news`              | 300 s            | Newest first; original summary + source link |
| `GET /publications`      | 300 s            | Newest first; `tag` = research topic         |

## Guarantees

- Only documents with `_status = published` and `reviewStatus = approved`
  (archived: detail only) are returned; drafts, rejected items, internal notes,
  evidence, bot snapshots, ingestion logs, and user data are never exposed.
- Articles/news/publications with a future `publishAt` are hidden until then.
- Images are returned only for media marked **public** with publication rights
  (`owned`, `licensed`, `permission_granted`, `public_domain`, `creative_commons`).
  Scraped source images are never exposed.
- Event descriptions are plain text (no HTML). Publication abstracts are not exposed
  (copyright); the editor-reviewed summary is.
- All timestamps are ISO 8601 UTC.
- Unknown or repeated query parameters return 400. Errors use
  `{"error": {"code", "message", "requestId"}}`; internal errors never leak details.

## Caching, CORS, rate limiting

- `Cache-Control: public, max-age=60, s-maxage=<above>, stale-while-revalidate=<2×>`
  plus a weak `ETag`; send `If-None-Match` for `304`.
- Browser CORS is limited to `CORS_ORIGINS` (no credentials). CORS is not a security
  boundary: every endpoint is read-only and public anyway.
- `PUBLIC_API_RATE_LIMIT_PER_MINUTE` (default 120) per client IP (`CF-Connecting-IP`
  when `TRUST_PROXY_HEADERS=true`); `429` with `Retry-After`. Vercel server-side
  fetches share Vercel egress IPs, so keep ISR caching on.
- Security headers: `nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY`,
  `Permissions-Policy`, HSTS.

## On-demand revalidation

When `REVALIDATE_WEBHOOK_URL` and `REVALIDATE_WEBHOOK_SECRET` are set, the CMS
POSTs `{"tags": ["events", "events:<slug>"]}` with header
`X-Revalidate-Secret: <secret>` whenever published content is published, updated,
unpublished, cancelled, archived, rejected, or deleted (3 attempts, 5 s timeout,
never blocking saves). The secret exists only in CMS and website server env.

Example Next.js route on the website (not part of this repository):

```ts
// app/api/revalidate/route.ts
import { revalidateTag } from 'next/cache';
import { timingSafeEqual } from 'node:crypto';

export async function POST(request: Request) {
  const supplied = Buffer.from(
    request.headers.get('x-revalidate-secret') ?? '',
  );
  const expected = Buffer.from(process.env.CONTENT_REVALIDATE_SECRET ?? '');
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { tags } = (await request.json()) as { tags: string[] };
  for (const tag of tags.slice(0, 20)) revalidateTag(tag);
  return Response.json({ revalidated: tags.length });
}
```

## Consuming from Next.js (Vercel)

```ts
const response = await fetch(
  `${process.env.CONTENT_API_BASE_URL}/api/public/v1/events?freeFood=true`,
  {
    next: { revalidate: 900, tags: ['events'] },
  },
);
if (!response.ok) throw new Error('Failed to fetch events');
const { data, nextCursor } = await response.json();
```

Typed client from the OpenAPI contract:

```bash
pnpm --filter @watcher/content-cms openapi:export          # or download /api/public/openapi.json
npx openapi-typescript apps/content-cms/openapi/public.json -o src/lib/content-api.d.ts
```

```ts
import type { components, paths } from './content-api';
type PublicEvent = components['schemas']['PublicEvent'];
type EventQuery = paths['/public/v1/events']['get']['parameters']['query'];
```

Tag detail pages with `events:<slug>` (or `articles:<slug>`) to benefit from
targeted revalidation.
