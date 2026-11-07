# Content CMS Contract

Read this file completely before creating or modifying `apps/content-cms`, its ingestion or public APIs, or any bot integration that sends content to it. The full product specification is [`docs/superpowers/specs/2026-11-06-vantuch-content-hub.md`](../superpowers/specs/2026-11-06-vantuch-content-hub.md); this file records the binding repository decisions.

## Approved exception

- `apps/content-cms` is a Payload CMS 3.x application (Next.js App Router) and the only approved web UI in this repository besides existing documentation surfaces.
- Payload is the single source of truth for editorial and published content. Bots keep their own operational data (crawl history, deduplication, briefing, notifications) in their existing tables.
- Keep the CMS isolated so it can be extracted into a standalone repository: its own `package.json` dependencies, Dockerfile, image, Compose service, migrations, environment schema, and README. It must not import another app's private source; it may consume a workspace package only when that package has no Prisma or bot runtime coupling.

## Infrastructure decisions

- Database: Payload's official Postgres adapter against the existing Watcher database on `watcher-postgres`. Payload and Prisma own distinct tables and migrations; Payload migrations run during CMS startup. Bot content crosses the CMS API, while operational state remains in Prisma. Do not add another PostgreSQL service.
- Media: the existing external RustFS (`http://rustfs:9000` on the `vantuch` network) through `@payloadcms/storage-s3` with path-style addressing and CMS-specific credentials and buckets. Do not add object storage.
- Ingress: Cloudflare Tunnel on the external `vantuch` network, like `bots.vantuch.dev`. Target host `cms.vantuch.dev`. Cloudflare Access protects `/admin` and private ingestion docs; `/api/public/*` stays publicly reachable. There is no Nginx in this repository.
- Do not add Redis, queues, or a separate Fastify API. Rate limiting is in-process.

## Security

- Native Payload REST and GraphQL access to every collection is denied to anonymous users. Website consumers use only `/api/public/v1/*`, which returns explicit DTOs.
- The public API serves only records whose review status is `approved` and whose Payload status is `published`. `rejected` never appears; `archived` never appears in listings.
- Bot credentials are per-bot, scoped, rotatable, stored hashed, and can never publish or approve.
- Bots never call Payload's database directly; they use the authenticated ingestion API.

## Bot integration

- Bots send content through a persistent outbox in their own database and a retrying sender with bounded retries and backoff. CMS outages must never block or delay Telegram/briefing delivery and must never lose content.
- For `apps/brno-events-agent`, integrate through the existing `BrnoEventPublisher` contract. Do not change `BriefingBrnoEventPublisher` behavior or its deduplication.
- Stable identity is `sourceId` plus `externalId` (or canonical event URL). Repeated identical submissions are no-ops.
- Human edits are never silently overwritten: keep the latest bot snapshot, editorial content, and pending proposed updates separately.
- Free food classification is `yes | no | unknown` with stored evidence. `yes` and `no` only on explicit evidence; free admission never implies free food.

## Copyright

- Store facts, short original summaries, attribution, and organizer links. Do not copy full third-party descriptions or republish third-party images without a recorded license.
