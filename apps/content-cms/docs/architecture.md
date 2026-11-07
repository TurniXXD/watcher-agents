# Architecture

```
Watcher monorepo bots ──(HTTPS, per-bot bearer token, vantuch network)──▶ /api/ingest/v1
                                                                            │
                         Payload CMS (Next.js App Router, apps/content-cms) │
   ┌───────────────────────────────────────────────────────────────────────┘
   │  ingestion service ─▶ ingestion-records (raw bot snapshots)
   │                     ─▶ content collections (editorial drafts/versions)
   │                     ─▶ pending-updates (proposed bot changes)
   │  editorial hooks (review status, publication guard, live-row sync)
   │  public API (/api/public/v1) ─ read-only, published + approved only
   │  OpenAPI 3.1 (generated from the same Zod schemas) + Swagger UI
   ├─▶ PostgreSQL: Watcher database on watcher-postgres, separate Payload tables
   └─▶ RustFS (S3-compatible, existing instance on the vantuch network)
                                   ▲
Next.js website (Vercel) ──fetch──┘  /api/public/v1/* with ISR + tag revalidation
```

## Components

| Concern          | Implementation                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| Application      | Payload 3.93, Next.js 16 App Router, React 19, strict TypeScript                                 |
| Database         | `@payloadcms/db-postgres`, UUID ids, `push: false`, committed migrations (`src/migrations`)      |
| Media            | `@payloadcms/storage-s3` → RustFS, served through Payload so access control applies              |
| Validation       | Zod at every boundary (env, ingestion items, public query parameters, DTOs)                      |
| Custom endpoints | Payload root `endpoints` (`src/system`, `src/public-api`, `src/ingestion`, `src/openapi`)        |
| Logging          | Payload's pino logger, JSON, `service: content-cms`; audit lines for ingestion and auth failures |
| Scheduling       | Payload jobs `autoRun` (scheduled publish/unpublish) inside the long-running server              |

## Three stores per bot record

Bot output, editorial content, and proposals are deliberately separate:

1. **`ingestion-records`** (“Bot Snapshots”): latest raw bot values per stable identity
   `<collection>:<botId>:<externalId>` (unique index). Unversioned.
2. **Content collections** (`events`, `articles`, `news`, `publications`, `social-posts`):
   editorial values with Payload drafts and versions.
3. **`pending-updates`**: bot changes that would overwrite reviewed, published, or
   human-edited content, waiting for an editor.

See [editorial workflow](editorial-workflow.md) for the merge rules.

## Decisions

- **Isolated app, shared database.** The CMS has its own dependencies, image,
  Compose service, environment schema, and Payload (Drizzle) migrations. In
  production it uses the Watcher database on `watcher-postgres`. Its tables do
  not overlap Prisma's; each application migrates only its own tables. Bot
  content reaches Payload over HTTP, while operational state stays in Prisma.
  The API contract is the exported OpenAPI file.
- **No separate events API.** Public and ingestion APIs are Payload root endpoints.
- **Native APIs are closed.** Content collections are readable only by signed-in staff;
  the public API queries with `overrideAccess` plus explicit published/approved filters.
  GraphQL is disabled.
- **Draft saves never touch live rows.** Payload keeps the published document in the main
  table; editorial work goes to versions. The CMS writes the live row directly only for
  safety corrections (cancellations, dates) and review decisions (reject/archive).
- **Telegram unaffected.** The Brno Events agent keeps its existing database,
  deduplication, scheduling, and briefing publication. CMS delivery uses a separate
  durable outbox flushed on its own timer.
- **Single instance.** Rate limits, ingestion locks, and caches are process-local; scale-out
  would need a shared limiter.
