# AGENTS.md

This file contains project-specific instructions for coding agents working on Watcher. It intentionally keeps only the rules from the central [TurniXXD agents-md template](https://github.com/TurniXXD/agents-md/blob/main/AGENTS.md) that apply to this repository.

## Project Scope

- Build a production-quality, self-hosted Watcher MVP for one operator on one Linux server.
- Keep all Telegram bots and internal agents in one TypeScript Turborepo. Every runnable app under `apps/` owns its process boundary; Telegram bots remain separate long-running Docker Compose services while sharing PostgreSQL and reusable workspace packages where there are concrete consumers.
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

- Keep top-level app entry points thin: process lifecycle, dependency wiring, bot-specific commands/callbacks, scheduling, and watcher orchestration belong in the owning app.
- Keep code under `packages/` only when it has concrete consumers in at least two runnable apps or it is required by a runtime package boundary such as database persistence. Bot-specific core/domain logic and source adapters belong under that bot's `src/` tree and must not declare nested package manifests. Do not promote code to a shared package for a hypothetical future consumer.
- Expected ownership:
  - `packages/core`: normalized watcher types, pipeline, deduplication, scheduling primitives, run results, and other behavior used by multiple runnable apps.
  - `apps/stocks-bot/src/core`: stock-only LLM analysis, decision policy, and monitoring behavior that is used only by the stocks bot.
  - `apps/stocks-bot/src/sources`: injectable stock source adapters and normalization.
  - `apps/publications-bot/src/sources`: injectable publication source adapters and normalization.
  - `packages/telegram`: authorization, common commands, keyboards, digest rendering, and message splitting.
  - `packages/database`: Prisma schema/client, focused repository-style persistence helpers, and stock-domain helpers shared by persistence and the stocks app. Do not duplicate these helpers back into the app.
  - `packages/llm`: provider contract, Ollama implementation, prompts, parsing, and validation.
- Keep database access in the database package or clearly isolated repositories. Do not query Prisma directly from Telegram handlers or source clients.
- Keep external HTTP clients injectable and mockable.
- Barrel files may contain simple re-exports only. Avoid duplicate exports and deep relative imports when a workspace package export exists.
- Avoid huge files and god classes. Extract shared behavior when it has a clear second consumer; do not create speculative abstractions.

## Telegram Bot Baseline And New-Bot Checklist

These requirements apply to every grammY-based Telegram bot in `apps/`, both existing and newly introduced. They do not apply to an internal HTTP-only agent that has no Telegram surface. A new Telegram bot is not scaffolded or complete until every applicable item below is implemented. When modifying an older bot, preserve these guarantees and bring the touched surface into compliance rather than copying an obsolete pattern.

### Mandatory informational commands

- Every Telegram bot must implement `/start`, `/help`, and `/about` as authorized commands.
- `/start` is the stable entry point. It may initialize required per-user settings or start an explicit onboarding flow, but it must explain what happens before requesting data. Repeated `/start` calls must be safe and idempotent.
- `/help` must be side-effect free. It must show the current command list, important aliases, required argument syntax, and the shortest useful examples. It must not initialize onboarding, trigger a watcher run, claim a scheduled job, or mutate user configuration merely to display help.
- `/about` must be side-effect free and distinct from `/help`. It must concisely explain:
  - the bot's purpose and intended operator;
  - its authoritative data store and important data flows;
  - external providers, local models, or other bots it relies on;
  - what is automated and what still requires explicit operator confirmation;
  - privacy, authorization, and safety boundaries;
  - important limitations and actions the bot never performs; and
  - the best next command, normally `/help` or the bot's main command.
- Keep each informational response within Telegram's message limit. Use the shared message-splitting utility when it can grow beyond one message; do not silently truncate it.
- Informational copy must describe only implemented behavior. Never include credentials, private identifiers, private data, unsupported guarantees, or marketing claims that are not grounded in the code.
- Use the bot's established language consistently. An English bot may use English copy and a Czech bot may use Czech copy; command names remain ASCII Telegram commands.

### Command registration and interaction rules

- Every bot must export a typed command registry and register it with Telegram through `setMyCommands` during startup. Include `start`, `help`, `about`, and the primary operator commands; keep names/descriptions within Telegram limits and keep the registry aligned with handlers and help text.
- Prefer exported, testable definitions such as `<botName>Help`, `<botName>About`, and `<botName>Commands` instead of embedding large informational strings in the entry point. App-specific help/about copy stays in the app; only its safe delivery/splitting mechanics should be shared.
- Register authorization middleware before commands, callback queries, photos, documents, free text, or any other update handlers. Authorization must cover `/start`, `/help`, and `/about` too; informational commands are not public bypasses.
- Every callback must use an owning bot-specific prefix, validate its payload, re-check ownership of referenced records, and answer the callback query. A callback from another bot or another user must not mutate state.
- Keep command handlers thin. Parse and validate Telegram input at the boundary, call an injectable service or repository, and render the result. Do not place direct Prisma queries, unmockable HTTP calls, or shell execution in handlers.
- A command that starts work must acknowledge it promptly, report bounded failures, and avoid duplicate delivery on retry. Manual and scheduled forms of the same operation must share the same service/pipeline.
- Do not reuse one Telegram token in multiple running services or start multiple long-polling consumers for the same token.

### Reuse and ownership

- Before adding a helper, search existing apps and workspace packages for the same behavior. Reuse `packages/telegram` for cross-bot authorization, message splitting, common rendering, and other genuine Telegram primitives.
- Reuse an existing domain package when the exact production behavior has a real second consumer. For example, shared contact parsing and persistence belong in a shared package when both Sales and Networking use them.
- Extract duplicated production behavior only after a concrete second consumer exists. Keep bot-specific commands, copy, policies, prompts, source adapters, and orchestration inside the owning app.
- Do not achieve reuse by importing another app's private `src/` files. Move the shared contract and implementation to an appropriately named workspace package, export it through that package, and keep both apps dependent on the package.
- Do not force superficially similar workflows into one abstraction when their authorization, persistence, confirmation, or failure semantics differ. Prefer a small duplicated adapter over a misleading shared domain model.
- Barrel files contain re-exports only. Shared packages must expose intentional public entry points; apps should not use deep relative imports into another package.

### Required app structure and runtime contract

- A runnable bot owns a main-folder `package.json`, `README.md`, strict TypeScript configuration, a thin `src/index.ts`, its bot/handler module, nearest `__tests__`, and a dedicated versioned docs page under `apps/docs/content/docs/bots`.
- `src/index.ts` owns environment parsing, dependency wiring, process lifecycle, command-menu registration, readiness startup, and graceful shutdown. Business rules stay in services, repositories, source adapters, or domain modules.
- Validate the complete environment with Zod before starting polling. Give optional features explicit configuration groups so partial credentials fail clearly rather than producing a half-configured runtime.
- Each bot must expose a private readiness endpoint on its own non-conflicting internal port, start polling only after dependencies are ready, and mark itself unready while shutting down.
- Handle both `SIGTERM` and `SIGINT`: stop scheduling, stop Telegram polling, close HTTP/readiness servers, and disconnect database/provider resources without abandoning in-flight state.
- Every bot gets its own Compose service, env preset/runtime file, Telegram token variable, healthcheck, restart policy, log limits, `init: true`, `no-new-privileges`, read-only filesystem where practical, and only the network access it actually needs.
- A newly introduced bot must be wired through the production contract in the same change: Dockerfile manifests/dependencies/artifacts, local and production Compose, `deploy/render-env.sh`, `deploy/deploy.sh`, CI configuration checks, deployment failure logs, rollback compatibility, maintenance health targets, `.env.example`, and `deploy/ENVIRONMENT.md`.
- Keep Ollama external. A bot using Ollama must use the shared provider/coordinator where applicable, bounded timeouts/retries, structured validated output, and a deterministic or clearly reported failure path.

### Persistence, scheduling, and delivery

- Persist operator-editable settings, schedules, durable sessions, and delivery/idempotency state in PostgreSQL. In-memory state is acceptable only for explicitly ephemeral interactions whose loss on restart is harmless and documented.
- Prevent overlapping runs per bot/workflow. Scheduled jobs must be claimed only by their owning service, survive restarts, and be completed or failed explicitly.
- Stable source IDs, external IDs, database constraints, and content/delivery hashes must prevent duplicate processing and duplicate Telegram delivery. Do not rely only on an in-memory set.
- Do not send empty scheduled digests or filler output. A manual command must still state clearly when no useful result was found.
- Any action affecting external people or systems—sending outreach, publishing content, confirming attendance, accepting a job, or writing an external record—requires the explicit confirmation described by that bot's contract. Never infer consent from viewing a message or opening a URL.

### Tests required for every bot

- Add a no-network bot test that sends authorized `/help` and `/about` updates through grammY and asserts the exact exported response or response pages.
- Test that `/help` and `/about` do not initialize onboarding, start a run, query mutable domain state unnecessarily, or write configuration. When `/start` intentionally initializes state, test repeat safety separately.
- Test that an unauthorized user cannot use informational commands, callbacks, uploads, or other handlers.
- If the bot exports a command registry, test that `help` and `about` are present and that registered commands have matching handlers/help documentation.
- Keep every informational message at or below Telegram's limit, or test the shared splitting behavior when it spans multiple messages.
- Mock Telegram, Ollama, storage, and third-party providers. Unit tests must never call live services.
- Add focused tests for input validation, callback ownership, duplicate delivery/idempotency, partial provider failure, scheduler overlap prevention, graceful stop behavior where non-trivial, and every bug fixed in the bot.

### Documentation requirements for every bot

- The app README and dedicated MDX page must list `/start`, `/help`, `/about`, the primary commands, configuration groups, integrations/sources, scheduling behavior, safety boundaries, and known limitations.
- When commands or behavior change, update handler copy, command registry, app README, versioned docs, deployment/env inventory, and tests in the same change. Do not leave BotFather/Telegram menus or examples describing removed commands.
- Link a new app README from the root README app index and its MDX page from the docs bot index/meta file in the same change.
- Add a concise maintenance changelog entry for user-visible runtime behavior. Never put secrets or real private data into examples, fixtures, screenshots, or documentation.

### Bot completion gate

Before declaring a new or modified Telegram bot complete, verify all of the following together:

1. Authorized `/start`, side-effect-free `/help`, and side-effect-free `/about` work through grammY.
2. The help/about copy, command registry, tests, README, and versioned documentation agree.
3. Shared behavior was reused only through a proper package with a concrete second consumer; no app imports another app's private source.
4. Input, environment, provider data, callbacks, and LLM output are validated at their boundaries.
5. Manual and scheduled execution are idempotent, non-overlapping, failure-isolated, and do not emit duplicate or empty scheduled messages.
6. Readiness, structured logging, graceful shutdown, container hardening, Compose wiring, deployment, rollback, and maintenance monitoring are present.
7. Relevant filtered checks pass during iteration, followed by every root quality gate in the Done Criteria.

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

- Treat all Telegram bots as private administration surfaces. Authorize every command, callback, upload, photo, and free-text workflow against configured Telegram user IDs before doing work.
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
- Each runnable app or bot under `apps/` must own a `README.md` in its main folder. Put app-specific commands, configuration, source support, limitations, scheduling behavior, and setup instructions there rather than expanding the root README.
- Keep the root `README.md` concise: project overview, shared workspace setup, common quality gates, shared architecture/operations, and links to every app README. When adding a runnable app, add its README and root index link in the same change.
- Keep app READMEs, shared deployment documentation, migrations, and the root app index aligned with the actual implementation.
- Do not hard-code a personal watchlist or publication query as mandatory seed data.

### Documentation Maintenance

- Versioned documentation is located in `apps/docs` and its local MDX content is under `apps/docs/content/docs`.
- Whenever modifying bot behavior, integrations, environment variables, configuration, APIs or interfaces, scheduling, deployment, or architecture, update the corresponding documentation in the same change.
- When introducing a new bot or runnable application, create both its main-folder `README.md` and its dedicated documentation page, then link both from their indexes.
- When removing functionality, remove or update obsolete documentation.
- Never document secrets, tokens, private credentials, or real private data.
- Do not invent functionality that has not been implemented. Ground technical claims in the codebase and current operational contracts.
- Prefer updating an existing page instead of creating redundant documentation.

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
