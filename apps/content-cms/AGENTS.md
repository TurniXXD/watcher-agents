<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Content CMS contract

- Follow `docs/agent/content-cms.md` at the repository root. Keep the app extractable: no `workspace:*` dependencies, no imports from other apps or packages, own Dockerfile, image, migrations, and the opt-in `content-cms` Compose service using a `content_cms` database on `watcher-postgres` (never a separate PostgreSQL service).
- After changing collections or fields, run `pnpm migrate:create <name>`, `pnpm generate:types`, and (for admin components) `pnpm generate:importmap`; commit the results. Keep migrations additive.
- Public API, ingestion schemas, and OpenAPI are generated from the same Zod schemas; after changing them run `pnpm openapi:export` and keep `docs/` in sync.
- Never expose drafts, rejected content, internal fields, or credentials through public endpoints; enforce workflow rules in hooks/access, not only in the admin UI.
- Update `README.md` and the relevant `docs/*.md` page plus `apps/docs/content/docs/bots/content-cms.mdx` in the same change.
