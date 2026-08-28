# AGENTS.md

This file contains project-specific instructions for coding agents working on Watcher. It intentionally keeps only the rules from the central [TurniXXD agents-md template](https://github.com/TurniXXD/agents-md/blob/main/AGENTS.md) that apply to this repository.

## Project Scope

- Build a production-quality, self-hosted Watcher MVP for one operator on one Linux server.
- Keep both Telegram bots in one TypeScript Turborepo: `apps/stocks-bot` and `apps/publications-bot`.
- Keep the bots as separate long-running processes and Docker Compose services. They share PostgreSQL and reusable workspace packages.
- Telegram is the only user interface. Do not add a web UI.
- Ollama is an external service. Do not add it to Docker Compose.
- Prefer the simplest robust design suitable for a single server. Do not add Redis, queues, event buses, Kubernetes, host cron, systemd timers, or extra services.

## Required Stack

- Use TypeScript in strict mode, Node.js, pnpm, Turborepo, PostgreSQL, Prisma, grammY, Zod, Vitest, Docker, and Docker Compose.
- Always use `pnpm` for dependency installation, scripts, and lockfile updates. Do not use npm or Yarn.
- Keep dependencies minimal and use current stable versions.
- Prefer `type` over `interface` except when an intentionally extensible contract is clearer as an interface.
- Use ES module syntax and arrow functions unless a framework or library API makes another form clearer.
- Validate environment variables, Telegram input, external API data, and LLM output with Zod at their boundaries.

## Architecture And Ownership

- Keep apps thin: process lifecycle, dependency wiring, bot-specific commands/callbacks, scheduling, and watcher orchestration belong in the app.
- Put reusable domain logic in packages. Expected ownership:
  - `packages/core`: normalized watcher types, pipeline, deduplication, scheduling primitives, and run results.
  - `packages/telegram`: authorization, common commands, keyboards, digest rendering, and message splitting.
  - `packages/database`: Prisma schema/client and repository-style persistence helpers.
  - `packages/llm`: provider contract, Ollama implementation, prompts, parsing, and validation.
  - `packages/stock-sources` and `packages/publication-sources`: injectable source adapters and normalization.
- Keep database access in the database package or clearly isolated repositories. Do not query Prisma directly from Telegram handlers or source clients.
- Keep external HTTP clients injectable and mockable.
- Barrel files may contain simple re-exports only. Avoid duplicate exports and deep relative imports when a workspace package export exists.
- Avoid huge files and god classes. Extract shared behavior when it has a clear second consumer; do not create speculative abstractions.

## Watcher Pipeline

- Normalize all provider responses into the shared `WatchItem` shape before deduplication or analysis.
- Use stable source identity (`source` plus `externalId`) and content hashes where useful. Enforce idempotency with database constraints, not only in-memory checks.
- Use `Promise.allSettled()` for independent source operations. One source failure must not cancel other sources.
- Wait for every configured source before producing the final run result and digest. Include source failures in that result.
- Manual and scheduled runs must call exactly the same pipeline.
- Prevent overlapping runs for each watcher. Persist schedule state and configuration in PostgreSQL.
- Do not send already processed content again. Do not create fake source data.
- Do not send a scheduled digest when nothing useful is new. A manual `/run` must report that nothing new was found.

## Sources And LLM

- Prefer official APIs, structured endpoints, and RSS feeds over HTML scraping.
- SEC EDGAR and PubMed are the first fully functional sources. Respect provider rate limits and SEC identification requirements.
- Source-specific formats must not leak beyond their adapter package.
- The Ollama provider must request structured JSON and validate the response with Zod.
- Retry malformed LLM output only a small, bounded number of times. Record a failed analysis instead of crashing the watcher run.
- Send only useful extracted content to Ollama. Prompts must separate sourced facts from inference and must not encourage invented details.

## Security And Operations

- Treat both bots as private administration surfaces. Authorize every command and callback against configured Telegram user IDs before doing work.
- Never log or commit bot tokens, database passwords, API credentials, or full secret-bearing URLs.
- Infrastructure secrets remain environment variables and must not be editable through Telegram.
- Validate user-provided URLs and prevent access to loopback, link-local, private-network, and other unsafe targets unless a source integration explicitly owns a trusted endpoint.
- Never execute shell commands assembled from Telegram or source content.
- Use structured logs and handle errors explicitly. A failed item, source, or analysis must not silently disappear.
- Handle `SIGTERM` and `SIGINT` gracefully so Docker shutdown stops polling and closes bot/database resources safely.
- Keep PostgreSQL private to the Compose network, use a named volume, and gate app startup on migrations and database health.
- Run containers as a non-root user where practical, use `no-new-privileges`, and keep runtime images minimal.

## Configuration And Documentation

- Add every used environment variable to `.env.example` with a safe placeholder or development default. Never add real secrets.
- Persist all Telegram-editable watcher configuration in PostgreSQL.
- Keep README commands, environment variables, source support, limitations, migrations, scheduling behavior, and deployment steps aligned with the actual implementation.
- Do not hard-code a personal watchlist or publication query as mandatory seed data.

## Production Deployment

- Keep the production release contract aligned across `.github/workflows/deploy-vps.yml`, `docker-compose.production.yml`, and `deploy/deploy.sh`.
- Production publishes one shared Watcher image tagged with the exact commit SHA. Do not replace immutable release tags with `latest` in the deployment state.
- GitHub stores only SSH, GHCR, and Tailscale transport credentials. Application runtime secrets stay in mode-`0600` files under `deploy/runtime` on the VPS and must never be committed or uploaded by CI.
- Tailscale CI access must use an ephemeral tagged identity with least-privilege access to the Watcher VPS SSH port.
- Preserve pre-deployment PostgreSQL backups, migration-before-rollout ordering, serialized production deploys, health checks, failure logs, and application-image rollback.
- Database migrations must remain compatible with the previous application image because an image rollback does not reverse an applied migration.

## Testing

- Keep tests in the nearest `__tests__` directory.
- Test reusable utilities and every important failure path.
- At minimum maintain coverage for deduplication, next-run calculation, overlap prevention, item normalization, LLM parsing/validation, Telegram authorization, Telegram message splitting, and partial source failure handling.
- Do not make live Telegram, Ollama, SEC, PubMed, or other third-party calls in unit tests.
- Use PostgreSQL-backed integration tests for behavior that depends on Prisma constraints or transactions; do not substitute an incompatible database.
- When fixing a bug, add a regression test when practical.

## Commands And CI Contract

The root workspace must expose these commands once the workspace scaffold exists:

- `pnpm format:check` checks formatting without modifying files.
- `pnpm lint` runs ESLint across the monorepo.
- `pnpm typecheck` runs strict TypeScript checks.
- `pnpm test` runs Vitest once in CI mode.
- `pnpm build` builds all apps and packages.
- `pnpm db:generate` generates Prisma Client.
- `pnpm db:validate` validates the Prisma schema and migrations without changing production data.
- `pnpm db:deploy` applies committed Prisma migrations non-interactively.

Use filtered Turbo or pnpm commands while iterating, then run the complete root checks before finishing. The GitHub Actions workflow in `.github/workflows/ci.yml` is the authoritative merge gate.

## Done Criteria

Before considering implementation work complete:

1. Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.
2. Run `pnpm db:validate` for database or schema changes.
3. Run `docker compose config --quiet` for Compose changes and build the production image for Docker changes.
4. Confirm no secrets, fake data, or mandatory personal seed data were added.
5. Confirm source failures are isolated, duplicate delivery is prevented, and shutdown remains graceful.
6. Update the README when commands, configuration, source support, or operational behavior changed.
