# Testing, Verification, And Agent Efficiency

Read this file completely before any implementation, command-heavy diagnosis, test or bug-fix work, CI change, or final verification.

## Testing contract

- Keep tests in the nearest `__tests__` directory.
- Test reusable utilities and every important failure path.
- Maintain coverage for deduplication, next-run calculation, overlap prevention, item normalization, LLM parsing/validation, Telegram authorization, Telegram message splitting, and partial-source failure handling.
- Unit tests never make live Telegram, Ollama, SEC, PubMed, or other third-party calls.
- Behavior depending on Prisma constraints or transactions uses PostgreSQL-backed integration tests, not an incompatible database substitute.
- Add a practical regression test for every bug fix.

## Commands and CI contract

The root workspace exposes:

- `pnpm format:check` — formatting check without modifications.
- `pnpm lint` — ESLint across the monorepo.
- `pnpm typecheck` — strict TypeScript checks.
- `pnpm test` — Vitest once in CI mode.
- `pnpm build` — builds all apps and packages.
- `pnpm db:generate` — generates Prisma Client.
- `pnpm db:validate` — validates Prisma schema and migrations without changing production data.
- `pnpm db:deploy` — applies committed Prisma migrations non-interactively.

`.github/workflows/ci.yml` is the authoritative merge gate.

## Efficient validation cadence

- During iteration, run the narrowest relevant filtered test, typecheck, lint, or build command.
- After the last relevant edit, run each applicable final root gate exactly once. Rerun a gate only after affected code changes or to confirm a specific failure was fixed.
- Do not repeat an identical read-only command when neither its inputs nor relevant repository state changed.
- Keep tool observations bounded: target at most about 40 KB or 10,000 tokens. Use focused paths and globs, exclude generated artifacts, and return concise failure summaries or the last 50–100 relevant lines instead of unrestricted logs.
- Keep full verbose logs outside the conversation in a temporary or ignored file when needed; carry forward only the path, exit code, and useful summary.
- Do not manually reread an already-injected `AGENTS.md` or an already-read `SKILL.md` unless the exact text is needed to resolve a current ambiguity.
- For broad work, use explicit exploration, implementation, focused-verification, and final-verification phases. Preserve only a short checkpoint of decisions, changed files, evidence, and remaining work between milestones.
- Keep one coherent objective per chat. At a stable milestone in broad work, hand off with that checkpoint and continue in a fresh chat when the user and workflow allow it.

## Completion gate

Before considering implementation work complete:

1. After the last relevant edit, run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` once.
2. Run `pnpm db:validate` for database or schema changes.
3. Run `docker compose config --quiet` for Compose changes and build the production image for Docker changes.
4. Confirm no secrets, fake data, or mandatory personal seed data were added.
5. Confirm source failures remain isolated, duplicate delivery remains prevented, and shutdown remains graceful.
6. Update documentation when commands, configuration, source support, deployment, architecture, or operational behavior changed.
