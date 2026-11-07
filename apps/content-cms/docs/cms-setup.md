# CMS setup

## Local development

```bash
pnpm install
createdb content_cms                                  # or any PostgreSQL 16 database
cp apps/content-cms/.env.example apps/content-cms/.env
# DATABASE_URI=postgresql://…/content_cms, PAYLOAD_SECRET=$(openssl rand -hex 32)
pnpm --filter @watcher/content-cms migrate
pnpm --filter @watcher/content-cms dev                # http://localhost:3100/admin
```

Without RustFS variables in development, uploads are stored in
`apps/content-cms/media-local/` (git-ignored). Production refuses to start without
RustFS.

## Environment variables

| Variable                                                               | Required        | Default                 | Purpose                                                                                                                         |
| ---------------------------------------------------------------------- | --------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URI`                                                         | Local           | –                       | Standalone development PostgreSQL URL                                                                                           |
| `DATABASE_URL`                                                         | Prod            | –                       | Shared Watcher database URL, inherited from `deploy/runtime/migrate.env`; `postgres` hostname is resolved as `watcher-postgres` |
| `DATABASE_POOL_MAX`                                                    | No              | 10                      | Connection pool size                                                                                                            |
| `PAYLOAD_SECRET`                                                       | Yes             | –                       | ≥ 32 random chars; signs sessions. Rotating it logs everyone out                                                                |
| `SERVER_URL`                                                           | Prod            | `http://localhost:3100` | Public origin (`https://cms.vantuch.dev`), used for URLs, CORS, CSRF                                                            |
| `CORS_ORIGINS`                                                         | No              | –                       | Comma-separated website origins allowed to call the public API                                                                  |
| `CSRF_ORIGINS`                                                         | No              | –                       | Extra origins allowed to send admin cookies                                                                                     |
| `LOG_LEVEL`                                                            | No              | `info`                  | pino level                                                                                                                      |
| `TRUST_PROXY_HEADERS`                                                  | No              | `false`                 | Honour `CF-Connecting-IP`/`X-Forwarded-For` (true behind cloudflared)                                                           |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Prod (together) | –                       | RustFS connection                                                                                                               |
| `S3_REGION`                                                            | No              | `us-east-1`             | S3 region                                                                                                                       |
| `S3_FORCE_PATH_STYLE`                                                  | No              | `true`                  | Path-style addressing (RustFS)                                                                                                  |
| `S3_PREFIX`                                                            | No              | `content-cms`           | Object key prefix                                                                                                               |
| `MEDIA_MAX_IMAGE_SIZE_MB` / `_DOCUMENT_` / `_VIDEO_`                   | No              | 15 / 25 / 200           | Per-type upload limits                                                                                                          |
| `PUBLIC_API_RATE_LIMIT_PER_MINUTE`                                     | No              | 120                     | Per client IP                                                                                                                   |
| `INGEST_RATE_LIMIT_PER_MINUTE`                                         | No              | 60                      | Per bot credential                                                                                                              |
| `INGEST_MAX_BODY_BYTES` / `INGEST_MAX_BATCH_SIZE`                      | No              | 1000000 / 100           | Ingestion request limits                                                                                                        |
| `REVALIDATE_WEBHOOK_URL`, `REVALIDATE_WEBHOOK_SECRET`                  | No (together)   | –                       | Website on-demand revalidation                                                                                                  |
| `WEBSITE_PREVIEW_URL`, `PREVIEW_SECRET`                                | No (together)   | –                       | Signed draft-preview links                                                                                                      |
| `PAYLOAD_JOBS_AUTORUN`                                                 | No              | `true`                  | Run scheduled publish jobs in-process                                                                                           |
| `MCP_ENABLED`                                                          | No              | `true`                  | Serve the MCP endpoint `POST /api/mcp` ([MCP server](mcp.md))                                                                   |

## Migrations

Payload migrations live in `src/migrations` and are committed. The production
image applies pending migrations on startup (`prodMigrations`). After changing a
collection:

```bash
pnpm --filter @watcher/content-cms migrate:create describe-change
pnpm --filter @watcher/content-cms generate:types
pnpm --filter @watcher/content-cms generate:importmap   # when admin components change
```

Keep migrations backward compatible with the previous image (additive first),
because rolling back the image does not roll back the database.

## Legacy bot content import

Content the bots stored before the CMS integration is imported once by the
`20261107_141700_queue_legacy_bot_content_backfill` migration. The migration only
queues the `backfillLegacyBotContent` Payload job; the jobs autoRun executes it in
the background (within about a minute of startup), so a large backlog never
delays readiness. It reads the shared Watcher database read-only and submits rows
through the normal ingestion service under each bot's id:

| Source table (Prisma)                               | CMS collection | Bot id              | External id           |
| --------------------------------------------------- | -------------- | ------------------- | --------------------- |
| `brno_events` + `brno_event_source_links`           | `events`       | `brno-events-agent` | `brno-event:<id>`     |
| `ProcessedItem` (`NEWS`) + latest `Analysis`        | `news`         | `news-bot`          | `processed-item:<id>` |
| `ProcessedItem` (`PUBLICATIONS`, publications only) | `publications` | `publications-bot`  | `processed-item:<id>` |
| `social_content_items` (LinkedIn/Instagram)         | `social-posts` | `socials-bot`       | `social-content:<id>` |
| `social_content_items` (blog, newsletter)           | `articles`     | `socials-bot`       | `social-content:<id>` |

- Everything arrives as an `ingested` draft for review; nothing is published.
- Identities that already exist (for example events the agent already synced)
  are skipped, so bot-delivered content is never overwritten; retries resume.
- Events use the agent's mapping with `freeFood: unknown`, because the
  classifier lives in the agent; it refines upcoming events on its next sighting.
- News carries only the bot's own LLM summary and a link, never feed text.
  Publications include the abstract and AI summary; FDA reports and clinical
  trials are not imported. Social items need draft or final text and are not
  `SKIPPED`/`ARCHIVED`.
- Missing bot tables (a standalone CMS database) make the job a no-op. Progress
  and per-item failures are logged as `Legacy bot content backfilled` /
  `Legacy content item was not imported` and recorded as ingestion runs.
- Future bot integrations should reuse these bot ids and external ids so
  their updates land on the imported records.

## RustFS media storage

Reuse the existing RustFS on the `vantuch` network; do not add another object store.

1. Create a bucket (e.g. `content-cms`) and an access key restricted to it.
2. Keep the bucket **private**. Files are streamed through Payload
   (`/api/media/file/<name>`), so media access control applies: private media
   requires a CMS login; public media must be marked _public_ and carry usage
   rights that permit publication (reviewers/admins only).
3. Allowed types: JPEG, PNG, WebP, AVIF, GIF, PDF, MP4, WebM (SVG is rejected).
   Images need alt text; thumbnails/card/hero sizes are generated with sharp.

## Users and roles

The first account registered at `/admin` becomes `admin`. Admins add editors and
reviewers under _Administration → Users_ (see [editorial workflow](editorial-workflow.md#roles)).
Logins lock for 15 minutes after 5 failures; sessions last 8 hours.

## Bot credentials

```bash
pnpm --filter @watcher/content-cms credentials:create -- --bot <bot-id> --scopes events[,news,…] [--expires-days 365]
```

In production, administrators create credentials in the admin under
_Administration → Bot Credentials → Create bot credential_ (the token is shown
once; the endpoint `POST /api/ingest/credentials` accepts admin sessions only).
See [ingestion API](ingestion-api.md#authentication-and-credentials).
