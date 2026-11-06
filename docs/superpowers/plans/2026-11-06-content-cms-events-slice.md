# Content CMS — Events Vertical Slice Implementation Plan

> **For agentic workers:** Read `AGENTS.md`, `docs/agent/content-cms.md`, `docs/agent/testing.md`, `docs/agent/deployment.md`, and `docs/agent/documentation.md` first. Implement task by task; tick checkboxes as you go.

**Goal:** Deliver the Events part of the Vantuch Content Hub end to end: Payload CMS foundation, editorial workflow, ingestion API, Brno Events Agent integration with free-food classification, public Events API, and OpenAPI/Swagger. Articles, News, Publications, and SocialPosts follow in a later plan.

**Spec:** [`docs/superpowers/specs/2026-11-06-vantuch-content-hub.md`](../specs/2026-11-06-vantuch-content-hub.md).

## Repository findings (2026-11-06)

- Brno Events Bot is `apps/brno-events-agent`, an internal Fastify service (port 4020), not a Telegram bot. It has 13 sources normalized to `RawEvent` (`src/domain/types.ts`), and `EventRepository.save()` persists Prisma `brnoEvent` and `brnoEventSourceLink` with dedup by source link, fingerprint, ±30 min proximity, and content hash.
- Telegram delivery is indirect: `BriefingBrnoEventPublisher` writes high-relevance and cancelled events to the briefing store and `briefing-bot` delivers them. The runner calls the publisher only for `created`/`updated` results (plus a one-time high-relevance backfill for duplicates).
- Integration point: add a second `BrnoEventPublisher` (CMS outbox) and compose both publishers so neither can fail the other.
- Infrastructure: shared `watcher-postgres` (pg16 + pgvector); external RustFS at `http://rustfs:9000` on the `vantuch` network (already used by study-bot); Cloudflare Tunnel ingress on `vantuch`; no Nginx; Redis only inside Twenty.
- No free-food classification exists yet.

## Phase 1 — CMS foundation

- [ ] Scaffold `apps/content-cms` with the latest stable Payload 3.x + Next.js App Router, strict TS, pnpm workspace entry, its own eslint/tsconfig/vitest wiring compatible with root gates.
- [ ] Zod-validated env (`DATABASE_URL`, `PAYLOAD_SECRET`, `CMS_PUBLIC_URL`, CORS/CSRF origins, `CMS_S3_*`, upload limits, revalidation URL and secret).
- [ ] Postgres adapter + Payload migrations; `@payloadcms/storage-s3` against RustFS (path-style).
- [ ] Users with roles admin/editor/reviewer; Media and Sources collections; deny anonymous access on native REST/GraphQL.
- [ ] Health/readiness endpoints, structured logging, graceful shutdown.
- [ ] Own Dockerfile (non-root, minimal), Compose service on `default` + `vantuch`, `.env.example` and `deploy/ENVIRONMENT.md` entries, CI build job. Do not deploy.

## Phase 2 — Events + editorial workflow

- [ ] Events collection per spec §5.1 (Payload drafts and versions, rich text, unique slug, `Europe/Prague` default, SEO, featured, eventStatus, freeFood + foodDetails + internal evidence, source attribution).
- [ ] Separate `reviewStatus`; server-side hooks/access: publish only when approved, bots never publish, rejected never public.
- [ ] Human-edit preservation: `botSnapshot`, editorial fields, `pendingUpdates` with per-field apply in admin; identical resubmission is a no-op; cancellation/date-change safety policy documented and enforced.
- [ ] IngestionRuns collection; admin filters and list views per spec §15.

## Phase 3 — Ingestion API + Brno Events Agent

- [ ] `POST /api/ingest/v1/events` (batch), `GET /api/ingest/v1/runs/:id`: per-bot hashed credentials with scopes and rotation, Zod validation, size limits, rate limiting, idempotent upsert, structured errors, audit log.
- [ ] Free-food classifier in brno-events-agent (deterministic rules over cs/en text with evidence; unknown by default) + tests.
- [ ] Prisma outbox table in `packages/database` + `ContentCmsEventPublisher` + retrying sender (bounded backoff, persisted failures) wired into `index.ts` alongside the briefing publisher; feature-flagged by env so the bot runs unchanged without CMS config.
- [ ] Short original summaries only; no third-party images without license.

## Phase 4 — Public Events API + docs

- [ ] `GET /api/public/v1/events`, `/events/:slug`, `/events/categories`, `/events/featured` with all spec §10 filters, Prague date-only semantics, deterministic cursor pagination, indexes, DTO, cache headers, CORS, security headers.
- [ ] Schema-driven OpenAPI 3.1 for public + ingest, Swagger UI routes, export script compatible with `openapi-typescript`.
- [ ] Secured on-demand revalidation webhook to vantuch.dev on publish/update/cancel/archive.

## Phase 5 — Verification and documentation

- [ ] Tests from spec §18 that apply to Events (PostgreSQL-backed for constraints/transactions; no live third-party calls).
- [ ] App README, `apps/docs` page, root README index link, spec §19 docs scoped to what is implemented, Cloudflare Access setup.
- [ ] Completion gate from `docs/agent/testing.md`, plus Docker build of the CMS image. Report results honestly.
