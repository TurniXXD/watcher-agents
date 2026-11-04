# Configuration And Documentation Contract

Read this file completely when changing commands, callbacks, configuration, environment variables, integrations, sources, scheduling, persistence, APIs, deployment behavior, architecture, or operator-visible behavior.

## Repository documentation

- Add every used environment variable to `.env.example` with a safe placeholder or development default. Never add real secrets.
- Persist Telegram-editable watcher configuration in PostgreSQL.
- Each runnable app under `apps/` owns a main-folder `README.md` with its commands, configuration, source support, limitations, scheduling, and setup instructions.
- Keep the root `README.md` concise: project overview, shared workspace setup, common quality gates, shared architecture/operations, and links to every app README. Add a new app's README and root index link together.
- Keep app READMEs, shared deployment documentation, migrations, and the root app index aligned with implementation.
- Never hard-code a personal watchlist or publication query as mandatory seed data.

## Versioned documentation

- Versioned documentation lives in `apps/docs`; local MDX content lives under `apps/docs/content/docs`.
- Treat `apps/jobs-bot/README.md` as the authoritative Jobs source inventory. Whenever a job source is added, removed, enabled, disabled, or changes connector requirements, update its source ID, integration state, collection method, required connector/configuration, Jobs versioned docs, and the source-inventory regression test together.
- Whenever behavior, integrations, environment variables, configuration, APIs, interfaces, scheduling, deployment, or architecture change, update the corresponding documentation in the same change.
- A new bot or runnable application requires both its main-folder README and dedicated documentation page, linked from their indexes.
- Remove or update obsolete documentation when functionality is removed.
- Never document secrets, tokens, private credentials, or real private data.
- Do not invent unimplemented functionality. Ground every technical claim in code and current operational contracts.
- Prefer updating an existing page over creating redundant documentation.
