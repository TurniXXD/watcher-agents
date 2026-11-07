# Vantuch Content Hub (`apps/content-cms`)

Payload CMS 3 application that is the single source of truth for editorial and
published content on [vantuch.dev](https://vantuch.dev). Bots submit content
through an authenticated ingestion API; editors review, edit, approve, and
publish it in the Payload admin; the website reads a read-only public REST API.

It has no Telegram surface. It keeps its own dependencies, Dockerfile, image,
migrations, and environment schema so it can later move to a standalone
`vantuch-content` repository. In production it is a required `content-cms`
service in every Watcher release, shares the Watcher PostgreSQL database on
`watcher-postgres`, and reads `deploy/runtime/content-cms.env`; see
[deployment](docs/deployment.md). It has no `workspace:*` dependencies.

| Surface          | Path (production: `https://cms.vantuch.dev`)   | Access                            |
| ---------------- | ---------------------------------------------- | --------------------------------- |
| Admin            | `/admin`                                       | Payload login + Cloudflare Access |
| Public API       | `/api/public/v1/*`                             | Anonymous, read-only              |
| Public Swagger   | `/api/public/docs`, `/api/public/openapi.json` | Anonymous                         |
| Ingestion API    | `/api/ingest/v1/*`                             | Per-bot bearer credentials        |
| Ingestion docs   | `/api/ingest/docs`, `/api/ingest/openapi.json` | CMS login (+ Cloudflare Access)   |
| Health/readiness | `/api/health`, `/api/ready`                    | Anonymous, no data                |

Native Payload REST endpoints for content collections require a CMS login;
GraphQL is disabled.

## Documentation

- [Architecture](docs/architecture.md) — components, data stores, decisions
- [CMS setup](docs/cms-setup.md) — local development, environment, migrations, RustFS, users
- [Editorial workflow](docs/editorial-workflow.md) — review states, roles, human-edit preservation, safety policy
- [Ingestion API](docs/ingestion-api.md) — bot authentication, credentials, request examples
- [Bot integration](docs/bot-integration.md) — Brno Events agent pipeline, free-food classification, adding bots
- [Public API](docs/public-api.md) — endpoints, caching, CORS, Next.js integration
- [Events API](docs/events-api.md) — filters, pagination, DTO, free food
- [Deployment](docs/deployment.md) — Docker, Compose, Cloudflare Access, backups, verification

## Quick start

```bash
pnpm install
cp apps/content-cms/.env.example apps/content-cms/.env   # set DATABASE_URI and PAYLOAD_SECRET
pnpm --filter @watcher/content-cms migrate
pnpm --filter @watcher/content-cms dev                   # http://localhost:3100/admin
```

The first account created at `/admin` becomes an administrator.

## Commands

| Command                                                                               | Purpose                                                   |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `pnpm --filter @watcher/content-cms dev`                                              | Development server on port 3100                           |
| `pnpm --filter @watcher/content-cms build`                                            | Production build (no database or secrets needed)          |
| `pnpm --filter @watcher/content-cms typecheck`                                        | Next type generation + strict TypeScript                  |
| `pnpm --filter @watcher/content-cms migrate`                                          | Apply committed Payload migrations                        |
| `pnpm --filter @watcher/content-cms migrate:create <name>`                            | Create a migration after a schema change                  |
| `pnpm --filter @watcher/content-cms generate:types` / `generate:importmap`            | Regenerate `src/payload-types.ts` / admin import map      |
| `pnpm --filter @watcher/content-cms credentials:create -- --bot <id> --scopes events` | Create a bot credential (token printed once)              |
| `pnpm --filter @watcher/content-cms openapi:export`                                   | Write `openapi/public.json` and `openapi/ingest.json`     |
| `pnpm exec vitest run apps/content-cms`                                               | Unit + PostgreSQL integration tests (`TEST_DATABASE_URL`) |

## Configuration

All variables are validated with Zod at startup (`src/env.ts`); invalid or
partial groups fail fast without echoing values. See
[`.env.example`](.env.example) and [CMS setup](docs/cms-setup.md#environment-variables).

Required: `DATABASE_URI` for standalone development, `PAYLOAD_SECRET` (≥ 32 chars).
Production reads the Watcher `DATABASE_URL` from `deploy/runtime/migrate.env`.
Production additionally
requires the RustFS group `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`.

## Known limitations

- Rate limits are in-process (single instance by design).
- Swagger UI assets load from jsDelivr (pinned version); the OpenAPI JSON is served locally.
- Social posts are planning records only; nothing is published to social platforms.
- Bot integration is implemented for the Brno Events agent; other bots can use the same API but are not yet wired.
- Public rich text is returned as plain text for events (and plain text plus Lexical JSON for article details).
