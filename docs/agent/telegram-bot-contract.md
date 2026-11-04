# Telegram Bot Contract

Read this file completely before creating or modifying a grammY-based Telegram bot under `apps/`. It does not apply to an internal HTTP-only agent with no Telegram surface. Preserve these guarantees on older bots and bring every touched surface into compliance instead of copying obsolete patterns.

## Mandatory informational commands

- Every Telegram bot must implement authorized `/start`, `/help`, and `/about` commands.
- `/start` is the stable entry point. It may initialize required per-user settings or start explicit onboarding, but it must explain what happens before requesting data. Repeated calls must be safe and idempotent.
- `/help` is side-effect free. It shows the current command list, important aliases, required argument syntax, and shortest useful examples. It must not initialize onboarding, trigger a run, claim a scheduled job, or mutate configuration.
- `/about` is side-effect free and distinct from `/help`. It concisely explains:
  - the bot's purpose and intended operator;
  - its authoritative data store and important data flows;
  - external providers, local models, or other bots it relies on;
  - what is automated and what still needs explicit operator confirmation;
  - privacy, authorization, and safety boundaries;
  - important limitations and actions it never performs; and
  - the best next command, normally `/help` or the bot's main command.
- Keep informational responses within Telegram's message limit. Use the shared splitting utility when they may grow; never silently truncate them.
- Describe only implemented behavior. Never include credentials, private identifiers or data, unsupported guarantees, or ungrounded marketing claims.
- Use the bot's established language consistently; command names remain ASCII Telegram commands.

## Command registration and interaction

- Export a typed command registry and register it with Telegram through `setMyCommands` during startup. Include `start`, `help`, `about`, and primary operator commands. Keep names and descriptions within Telegram limits and aligned with handlers and help text.
- Prefer exported, testable definitions such as `<botName>Help`, `<botName>About`, and `<botName>Commands` over large strings embedded in an entry point. App-specific copy stays in the app; only safe delivery and splitting mechanics belong in shared code.
- Register authorization middleware before commands, callback queries, photos, documents, free text, or any other update handler. Authorization covers `/start`, `/help`, and `/about` too.
- Every callback uses an owning bot-specific prefix, validates its payload, re-checks ownership of referenced records, and answers the callback query. A callback from another bot or user must not mutate state.
- Keep handlers thin: parse and validate Telegram input at the boundary, call an injectable service or repository, and render the result. Do not put direct Prisma queries, unmockable HTTP calls, or shell execution in handlers.
- A command that starts work acknowledges promptly, reports bounded failures, and avoids duplicate delivery on retry. Manual and scheduled forms of the same operation share the same service or pipeline.
- Never reuse one Telegram token in multiple running services or start multiple long-polling consumers for the same token.

## Reuse and ownership

- Before adding a helper, search existing apps and workspace packages for the same behavior. Reuse `packages/telegram` for genuine cross-bot primitives such as authorization, message splitting, and common rendering.
- Reuse a domain package only when the exact production behavior has a concrete second consumer. Shared contact parsing and persistence, for example, belong in a shared package when both Sales and Networking use them.
- Extract duplicated production behavior only after a concrete second consumer exists. Keep bot-specific commands, copy, policies, prompts, source adapters, and orchestration inside the owning app.
- Never import another app's private `src/` files. Move shared contracts and implementations into an appropriately named workspace package with intentional public exports.
- Do not force superficially similar workflows into one abstraction when authorization, persistence, confirmation, or failure semantics differ. Prefer a small duplicated adapter over a misleading shared model.
- Barrel files contain re-exports only. Apps do not use deep relative imports into another package.

## Required app structure and runtime contract

- A runnable bot owns a main-folder `package.json`, `README.md`, strict TypeScript configuration, thin `src/index.ts`, bot or handler module, nearest `__tests__`, and a dedicated versioned page under `apps/docs/content/docs/bots`.
- `src/index.ts` owns environment parsing, dependency wiring, process lifecycle, command-menu registration, readiness startup, and graceful shutdown. Business rules stay in services, repositories, source adapters, or domain modules.
- Validate the complete environment with Zod before polling. Optional features use explicit configuration groups so partial credentials fail clearly rather than producing a half-configured runtime.
- Each bot exposes a private readiness endpoint on a unique internal port, starts polling only after dependencies are ready, and becomes unready while shutting down.
- Handle both `SIGTERM` and `SIGINT`: stop scheduling and polling, close readiness servers, and disconnect database and provider resources without abandoning in-flight state.
- Each bot has its own Compose service, env preset/runtime file, Telegram token variable, healthcheck, restart policy, log limits, `init: true`, `no-new-privileges`, a read-only filesystem where practical, and only required network access.
- A new bot is wired through the production contract in the same change: Dockerfile manifests, dependencies and artifacts; local and production Compose; `deploy/render-env.sh`; `deploy/deploy.sh`; CI configuration checks; failure logs; rollback compatibility; maintenance health targets; `.env.example`; and `deploy/ENVIRONMENT.md`.
- Keep Ollama external. Bots using it use the shared provider/coordinator where applicable, bounded timeouts and retries, structured validated output, and a deterministic or clearly reported failure path.

## Persistence, scheduling, and delivery

- Persist operator-editable settings, schedules, durable sessions, and delivery/idempotency state in PostgreSQL. In-memory state is allowed only for explicitly ephemeral interactions whose loss on restart is harmless and documented.
- Prevent overlapping runs per bot and workflow. Scheduled jobs are claimed only by their owner, survive restarts, and are completed or failed explicitly.
- Stable source IDs, external IDs, database constraints, and content or delivery hashes prevent duplicate processing and Telegram delivery. Never rely only on an in-memory set.
- Do not send empty scheduled digests or filler. A manual command still states clearly when no useful result was found.
- Any action affecting external people or systems—outreach, publishing, attendance confirmation, accepting a job, or writing an external record—requires the explicit confirmation defined by that bot's contract. Viewing a message or opening a URL never implies consent.

## Required tests

- Add a no-network bot test that sends authorized `/help` and `/about` updates through grammY and asserts the exact exported response or response pages.
- Verify `/help` and `/about` do not initialize onboarding, start a run, query mutable domain state unnecessarily, or write configuration. When `/start` intentionally initializes state, test repeat safety separately.
- Verify an unauthorized user cannot use informational commands, callbacks, uploads, or other handlers.
- When a command registry is exported, verify `help` and `about` are present and every registered command has matching handler/help documentation.
- Keep every informational message at or below Telegram's limit, or test shared splitting when it spans multiple messages.
- Mock Telegram, Ollama, storage, and third-party providers. Unit tests never call live services.
- Add focused coverage for input validation, callback ownership, duplicate delivery/idempotency, partial provider failure, scheduler overlap prevention, non-trivial graceful stop behavior, and every fixed bug.

## Documentation requirements

- The app README and dedicated MDX page list `/start`, `/help`, `/about`, primary commands, configuration groups, integrations and sources, scheduling, safety boundaries, and known limitations.
- When commands or behavior change, update handler copy, registry, README, versioned docs, deployment/env inventory, and tests together. Do not leave Telegram menus or examples describing removed commands.
- Link a new app README from the root README app index and its MDX page from the docs bot index/meta file in the same change.
- Add a concise maintenance changelog entry for user-visible runtime behavior. Never put secrets or real private data in examples, fixtures, screenshots, or docs.

## Completion gate

Before declaring a new or modified Telegram bot complete, verify all of these together:

1. Authorized `/start`, side-effect-free `/help`, and side-effect-free `/about` work through grammY.
2. Help/about copy, command registry, tests, README, and versioned documentation agree.
3. Shared behavior is reused only through a proper package with a concrete second consumer; no app imports another app's private source.
4. Input, environment, provider data, callbacks, and LLM output are validated at their boundaries.
5. Manual and scheduled execution are idempotent, non-overlapping, failure-isolated, and emit neither duplicate nor empty scheduled messages.
6. Readiness, structured logging, graceful shutdown, container hardening, Compose wiring, deployment, rollback, and maintenance monitoring are present.
7. Relevant filtered checks pass during iteration, followed once by every applicable root quality gate in `docs/agent/testing.md` after the last relevant edit.
