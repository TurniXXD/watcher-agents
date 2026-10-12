# Watcher

Watcher is a production-oriented, self-hosted TypeScript monorepo for private Telegram bots and supporting agents. Services share PostgreSQL and reusable workspace packages while remaining separate long-running processes. Ollama is external to the Compose stack.

## Applications

Each application owns its setup, commands, configuration, source behavior, and limitations in its main folder.

| Application       | Purpose                                                              | Documentation                              |
| ----------------- | -------------------------------------------------------------------- | ------------------------------------------ |
| Briefing Bot      | Personalized audio briefings, Calendar, weather, and journal context | [README](apps/briefing-bot/README.md)      |
| Stocks Bot        | Watchlists, market intelligence, theses, alerts, and paper workflows | [README](apps/stocks-bot/README.md)        |
| Publications Bot  | Publication and clinical-source monitoring                           | [README](apps/publications-bot/README.md)  |
| News Bot          | RSS/Atom news monitoring and relevance analysis                      | [README](apps/news-bot/README.md)          |
| Reality Bot       | Real-estate monitoring and investment calculations                   | [README](apps/reality-bot/README.md)       |
| OSINT Bot         | Provenance-backed public-source investigations                       | [README](apps/osint-bot/README.md)         |
| Sales Bot         | Lead research, outreach preparation, and personal network management | [README](apps/sales-bot/README.md)         |
| Study Bot         | PDF lectures, quizzes, summaries, and flashcards                     | [README](apps/study-bot/README.md)         |
| Transport Bot     | Van-load compatibility and profitability decisions                   | [README](apps/transport-bot/README.md)     |
| Maintenance Agent | Health, quality, capacity, and release monitoring                    | [README](apps/maintenance-agent/README.md) |
| Brno Events Agent | Brno event discovery and briefing publication                        | [README](apps/brno-events-agent/README.md) |
| MU Clubs Monitor  | Masaryk University club activity monitoring                          | [README](apps/mu-clubs-monitor/README.md)  |
| Twenty Sales App  | Versioned Twenty CRM extension                                       | [README](apps/twenty-sales-app/README.md)  |

## Requirements and local development

- Node.js 24 or newer
- pnpm 11
- PostgreSQL 16 with pgvector
- Docker and Docker Compose for the production-like stack
- An external Ollama instance for LLM-enabled services

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:deploy
pnpm build
pnpm --filter @watcher/briefing-bot dev
```

Use a private environment file rather than adding secrets to `.env.example`:

```bash
WATCHER_ENV_FILE=/absolute/path/to/watcher.env docker compose up -d
```

The complete environment inventory is in [deploy/ENVIRONMENT.md](deploy/ENVIRONMENT.md). Safe service-specific examples live in [deploy/presets](deploy/presets).

## Quality gates

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run `pnpm db:validate` after Prisma changes and `docker compose config --quiet` after Compose changes.

## Shared architecture and operations

- `packages/core`: watcher pipeline, contracts, scheduling, networking, and shared types
- `packages/database`: Prisma schema, migrations, repositories, and persisted configuration
- `packages/llm`: Ollama requests, parsing, validation, and inference coordination
- `packages/sources`: reusable source adapters, safe HTTP behavior, and caching
- `packages/telegram`: authorization, keyboards, rendering, and message splitting
- `packages/observability`: run, source, feedback, and resource telemetry

Independent sources use failure isolation and normalized `WatchItem` records. PostgreSQL constraints provide durable idempotency. Telegram commands and callbacks are private administration surfaces protected by `TELEGRAM_ALLOWED_USER_IDS`.

Production publishes one immutable image per commit and runs each application as its own Compose service. PostgreSQL remains private, runtime secrets live only in mode-`0600` files under `deploy/runtime`, and Ollama remains external.

- [Production deployment](deploy/README.md)
- [Environment inventory](deploy/ENVIRONMENT.md)
- [Morning briefing architecture](docs/morning-briefing-architecture.md)
- [Evening journal workflow](docs/evening-journal.md)
- [Stock intelligence documentation](docs/stock-intelligence-phase-1.md)
- [OSINT architecture](docs/osint-architecture.md)

See [AGENTS.md](AGENTS.md) for repository constraints and completion criteria.
