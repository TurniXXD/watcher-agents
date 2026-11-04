# AGENTS.md

Project-specific instructions for coding agents working on Watcher. Keep this always-loaded file concise; detailed contracts are mandatory contextual references below.

## Mandatory contextual references

Read each applicable file completely before acting. Multiple scopes may apply.

- Creating or modifying any grammY bot, Telegram command, callback, upload, scheduling, delivery, authorization, or bot runtime: [`docs/agent/telegram-bot-contract.md`](docs/agent/telegram-bot-contract.md).
- Changing commands, configuration, environment variables, integrations, sources, persistence, APIs, architecture, or operator-visible behavior: [`docs/agent/documentation.md`](docs/agent/documentation.md).
- Changing Docker, Compose, deployment scripts, runtime env rendering, migrations, production workflows, healthchecks, monitoring, or rollback: [`docs/agent/deployment.md`](docs/agent/deployment.md).
- Any implementation, command-heavy diagnosis, test or bug-fix work, CI change, or final verification: [`docs/agent/testing.md`](docs/agent/testing.md).
- Under `apps/docs`, also follow the nearer [`apps/docs/AGENTS.md`](apps/docs/AGENTS.md).

## Project scope

- Build a production-quality, self-hosted Watcher MVP for one operator on one Linux server.
- Keep Telegram bots and internal agents in one strict TypeScript Turborepo. Each runnable app under `apps/` owns its process boundary; Telegram bots remain separate long-running Compose services while sharing PostgreSQL and workspace packages only where concrete consumers exist.
- Telegram is the only user interface. Do not add a web UI.
- Ollama is external. Do not add it to Compose.
- Prefer the simplest robust single-server design. Do not add Redis, queues, event buses, Kubernetes, host cron, systemd timers, or extra services.

## Required stack and style

- Use strict TypeScript, Node.js, pnpm, Turborepo, PostgreSQL, Prisma, grammY, Zod, Vitest, Docker, and Docker Compose.
- Always use `pnpm` for dependencies, scripts, and lockfile changes; never npm or Yarn.
- Keep dependencies minimal and on current stable versions.
- Prefer `type` over `interface` unless an intentionally extensible contract is clearer as an interface.
- Prefer ES modules and arrow functions unless a framework API makes another form clearer.
- Validate environment variables, Telegram input, external API data, and LLM output with Zod at their boundaries.

## Architecture and ownership

- Keep app entry points thin. They own process lifecycle, dependency wiring, bot-specific handlers, scheduling, and watcher orchestration; business rules belong in services, repositories, source adapters, or domain modules.
- Put code in `packages/` only when at least two runnable apps have concrete consumers or a runtime boundary such as database persistence requires it. Bot-specific core logic and adapters stay under that bot's `src/` tree and do not declare nested package manifests.
- Ownership boundaries:
  - `packages/core`: normalized watcher types, pipeline, deduplication, scheduling primitives, run results, and other cross-app behavior.
  - `apps/stocks-bot/src/core`: stocks-only LLM analysis, decision policy, and monitoring.
  - `apps/stocks-bot/src/sources` and `apps/publications-bot/src/sources`: owning app's injectable adapters and normalization.
  - `packages/telegram`: genuine cross-bot authorization, common commands, keyboards, rendering, and splitting primitives.
  - `packages/database`: Prisma schema/client, focused repositories, and stock-domain persistence helpers. Do not duplicate them in an app.
  - `packages/llm`: provider contract, Ollama implementation, prompts, parsing, and validation.
- Keep database access in `packages/database` or clearly isolated repositories. Telegram handlers and source clients never query Prisma directly.
- Keep external HTTP clients injectable and mockable.
- Barrel files contain re-exports only. Prefer workspace package exports over deep relative imports, and never import another app's private source.
- Avoid god classes and huge files. Extract shared behavior only for a real second consumer; do not create speculative abstractions.

## Watcher pipeline

- Normalize every provider response into the shared `WatchItem` shape before deduplication or analysis.
- Use stable identity (`source` plus `externalId`) and content hashes where useful. Enforce idempotency with database constraints, not only memory.
- Use `Promise.allSettled()` for independent sources. One source failure must not cancel the others.
- Wait for every configured source before producing the run result and digest; include source failures.
- Manual and scheduled runs call exactly the same pipeline.
- Prevent overlapping runs per watcher and persist schedule state and configuration in PostgreSQL.
- Never resend processed content or create fake source data.
- Scheduled runs stay silent when nothing useful is new; manual `/run` reports that nothing new was found.

## Sources and LLM

- Prefer official APIs, structured endpoints, and RSS feeds over HTML scraping.
- SEC EDGAR and PubMed are the first fully functional sources. Respect provider limits and SEC identification requirements.
- Source-specific formats do not leak past their adapters.
- Ollama requests structured JSON and validates it with Zod.
- Retry malformed LLM output only a small bounded number of times; record failed analysis instead of crashing the run.
- Send only useful extracted content to Ollama. Prompts distinguish sourced facts from inference and never encourage invention.

## Security and operations

- Treat every Telegram bot as a private administration surface. Authorize every command, callback, upload, photo, and free-text workflow against configured Telegram user IDs before work begins.
- Never log or commit bot tokens, database passwords, API credentials, or complete secret-bearing URLs. Infrastructure secrets remain environment variables and are never editable through Telegram.
- Validate user URLs and block loopback, link-local, private-network, and other unsafe targets unless a source integration explicitly owns a trusted endpoint.
- Never execute shell commands assembled from Telegram or source content.
- Use structured logs and explicit error handling. Failed items, sources, or analyses never disappear silently.
- Handle `SIGTERM` and `SIGINT` gracefully: stop scheduling and polling and close bot, server, database, and provider resources without abandoning in-flight state.
- PostgreSQL remains private to the Compose network, uses a named volume, and gates app startup on migrations and health.
- Run containers as non-root where practical, use `no-new-privileges`, and keep runtime images minimal.
