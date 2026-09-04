# Watcher

Watcher is a self-hosted, Telegram-only monitoring system for one operator. It runs two independent TypeScript bot processes on one Linux server:

- **Stocks Watcher** monitors SEC filings, FINVIZ insider transactions, Zacks rank/quote snapshots, Earnings Whispers earnings snapshots, and price snapshots.
- **Publications Watcher** monitors PubMed and optional bioRxiv, ClinicalTrials.gov, and openFDA results.

Both bots share PostgreSQL, the same idempotent watcher pipeline, and an external Ollama instance. There is no web UI, Redis, host cron, or bundled Ollama service.

## How it works

Each source normalizes provider data into a common `WatchItem`. A run waits for all enabled targets and sources with `Promise.allSettled`, records individual source failures, reserves new items through PostgreSQL uniqueness constraints, analyzes only reserved items with Ollama, and persists the run result. Already processed SEC filings, RSS/news entries, price snapshots, PubMed articles, bioRxiv papers, clinical trials, and FDA reports are skipped for both bots by their stable source identity. Manual and scheduled runs use this exact same path.

Schedule state and overlap locks are stored in PostgreSQL. A stale lock is recoverable after two hours. Scheduled runs send no message when nothing useful is new; `/run` sends an editable progress message and explicitly reports that no new content was found.

## Requirements

- Node.js 24
- pnpm 11.6.0
- Docker Engine with Docker Compose v2 for the recommended local and production paths
- Two private Telegram bots created with BotFather
- Ollama reachable from the bot containers, with the configured model already pulled
- An identifiable SEC user agent such as `Watcher/1.0 operator@example.com`

## Quick start with Docker Compose

1. Open `@BotFather` in Telegram, run `/newbot` twice, and keep the two resulting tokens separate. Disable group access if the bots do not need it. To find your numeric Telegram user ID, send a message to a reputable ID bot or call `https://api.telegram.org/bot<TOKEN>/getUpdates` once after messaging your new bot and read `message.from.id`. Put only trusted numeric IDs in `TELEGRAM_ALLOWED_USER_IDS`.

2. Copy the environment template and fill in real values:

   ```bash
   cp .env.example .env
   chmod 600 .env
   ```

3. Make sure Ollama accepts connections from Docker. On Linux and Docker Desktop, the default URL is `http://host.docker.internal:11434`. Pull the configured model first, for example `ollama pull qwen3:8b`.

4. Build, migrate, and start both bots:

   ```bash
   docker compose up -d --build
   docker compose ps
   docker compose logs -f stocks-bot publications-bot
   ```

PostgreSQL is not published to the host. Its data lives in the `watcher-postgres` named volume. The one-shot `migrate` service must complete before either bot starts.

The bots emit structured JSON logs. At `LOG_LEVEL=info`, each run records start, prepared source count, per-source fetch outcomes, source failures, notification sends, and completion counters. Set `LOG_LEVEL=debug` to also log individual item analysis and cached-analysis reuse.

To stop the application without deleting data:

```bash
docker compose down
```

## Local workspace development

Install and generate the Prisma client:

```bash
pnpm install --frozen-lockfile
DATABASE_URL=postgresql://watcher:watcher@localhost:5432/watcher pnpm db:generate
```

Start a PostgreSQL instance, set `DATABASE_URL`, apply the committed migration, and start either bot:

```bash
pnpm db:deploy
pnpm --filter @watcher/stocks-bot dev
pnpm --filter @watcher/publications-bot dev
```

The standard repository checks are:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm db:validate
pnpm build
docker compose config --quiet
```

Use `pnpm db:migrate -- --name <migration-name>` during schema development. Commit the generated migration and never run `migrate dev` against production.

## Environment variables

Every application variable is represented in `.env.example`.

| Name                                                | Used by               | Meaning                                                                                       |
| --------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------- |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | PostgreSQL            | Local Compose database initialization                                                         |
| `DATABASE_URL`                                      | migrations, both bots | PostgreSQL connection URL                                                                     |
| `STOCKS_TELEGRAM_TOKEN`                             | stocks bot            | BotFather token for the stocks bot                                                            |
| `PUBLICATIONS_TELEGRAM_TOKEN`                       | publications bot      | BotFather token for the publications bot                                                      |
| `TELEGRAM_ALLOWED_USER_IDS`                         | both bots             | Comma-separated Telegram numeric user IDs; every command and callback is denied unless listed |
| `OLLAMA_URL`                                        | both bots             | Ollama base URL                                                                               |
| `OLLAMA_MODEL`                                      | both bots             | Installed Ollama model name                                                                   |
| `OLLAMA_KEEP_ALIVE`                                 | both bots             | How long Ollama keeps the model loaded; defaults to `5m`                                      |
| `OLLAMA_MAX_ITEMS_PER_RUN`                          | both bots             | Maximum new items analyzed in one run; `0` means all new items and is the default             |
| `OLLAMA_NUM_CTX`                                    | both bots             | Per-request context size; defaults to `4096`                                                  |
| `OLLAMA_NUM_PREDICT`                                | both bots             | Maximum generated tokens per analysis; defaults to `768`                                      |
| `OLLAMA_RETRIES`                                    | both bots             | Retry count after a failed or invalid response; defaults to `1`                               |
| `OLLAMA_THINK`                                      | both bots             | Enables model thinking output; defaults to `false` to avoid unnecessary compute               |
| `OLLAMA_TIMEOUT_MS`                                 | both bots             | Per-attempt timeout, from 10–180 seconds; defaults to 120 seconds                             |
| `SEC_USER_AGENT`                                    | stocks bot            | SEC-compliant app name and contact address                                                    |
| `DEFAULT_TIMEZONE`                                  | both bots             | IANA timezone used for a newly created watcher                                                |
| `LOG_LEVEL`                                         | both bots             | Pino log level, normally `info`                                                               |

Infrastructure secrets cannot be edited through Telegram. Telegram-editable schedules, watchlists, query lists, and source switches are persisted in PostgreSQL.

## Telegram commands

Both bots support `/start`, `/help`, `/status`, `/listsources`, `/schedule [CRON] [TIMEZONE]`, `/run`, `/pause`, and `/resume`. `/help` prints the same initial command list as `/start`. `/listsources` lists each available provider with its website link.

Manual `/run` requests first send one progress message, then update that message with `editMessageText` while sources are fetched, items are prepared, and Ollama analyses run. Run digests use Telegram formatting with clear item separators, labeled summary and detail sections, bullet lists, source links, and total run time. Link previews are disabled to keep multi-item digests compact.

Stocks bot:

- `/stocks`
- `/addstock SYMBOL`
- `/removestock SYMBOL`
- `/sources` to toggle SEC, FINVIZ, Zacks, Earnings Whispers, and price
- `/listsources` to list available stock sources and provider links

Publications bot:

- `/queries`
- `/addquery TOPIC`
- `/addqueries` to import multiple topics from a CSV attachment
- `/removequery TOPIC`
- `/sources` to toggle PubMed, bioRxiv, ClinicalTrials.gov, and openFDA
- `/listsources` to list available publication sources and provider links

New stocks and publication queries enable every available source by default. Cron expressions use five fields; an optional final IANA timezone may be supplied. Use `/schedule` without arguments to view the current schedule and example syntax, or set one with `/schedule 0 8 * * * Europe/Prague`.

### Stocks

The watchlist starts empty. `ELAN`, `CVS`, `NVO`, `PFE`, and `BMY` are examples only; none is seeded or mandatory. Add only the symbols you want with `/addstock`. When a stock is added, Watcher resolves the ticker through SEC EDGAR, stores the company name and CIK, and shows the company name in `/stocks` and stock run digests.

Available per-stock sources are SEC EDGAR, FINVIZ insider transactions, Zacks rank/quote snapshots, Earnings Whispers earnings snapshots, and Price. Every source is enabled when a stock is added. Provider URLs are built into the bot; use `/sources` to change any source switch independently for each symbol.

### Publications

The query list also starts empty. Add a topic such as `/addquery mycorrhizal fungi`; it is stored exactly for display and in normalized form for duplicate protection. To import many topics, upload a CSV file with a `query` or `topic` column and reply to it with `/addqueries`, or attach the CSV with `/addqueries` as the document caption. If no header is present, the first column is used. PubMed, bioRxiv, ClinicalTrials.gov, and openFDA are enabled for new topics. Use `/sources` to independently disable a noisy source for a topic. Different topics can use different source combinations.

## Source support and limitations

- **SEC EDGAR:** fetches the company ticker directory, recent submissions, and filing documents. `SEC_USER_AGENT` is mandatory and requests are paced. The MVP checks recent filings only.
- **FINVIZ:** reads the public ticker quote page's insider-trading table and normalizes up to five recent rows. It links each result to the underlying SEC filing. FINVIZ HTML may change or throttle automated requests.
- **Zacks:** reads the public JSON quote feed used by the ticker page and emits a new snapshot when its visible Zacks Rank or quote facts change. The snapshot includes rank, price/change, forward P/E, and confirmed earnings date when provided. It does not access subscriber-only reports.
- **Earnings Whispers:** establishes the anonymous session used by the public ticker page, then reads its public earnings endpoints. It combines the next earnings date and estimates with the latest reported EPS/revenue surprise into one snapshot. It does not access subscriber-only data; the public endpoints may change or throttle automated requests.
- **PubMed:** uses NCBI E-utilities search and XML fetch endpoints.
- **Investor relations/news:** consumes a user-configured RSS or Atom URL. Literal loopback, private, link-local, and local-network hostnames are rejected. Only use feeds you trust and are authorized to access.
- **Price:** uses Stooq's public CSV endpoint and creates a new item based on the returned trading date.
- **bioRxiv:** queries the official API over a recent date window and filters matching title/abstract text.
- **ClinicalTrials.gov:** uses the v2 structured API.
- **openFDA:** searches drug adverse-event reports by generic drug name; a provider 404 is treated as no results.

External APIs can change, throttle, or return incomplete data. One source failure does not cancel other source results and is included in the run record and digest. The system does not invent fallback content.

Ollama responses are requested as structured JSON and validated with Zod. Malformed responses get a small bounded retry; persistent failures are stored as failed analyses instead of crashing the run. Source content is truncated before it is sent to the model.

## Ollama resource protection

Watcher intentionally does not use Redis for Ollama coordination. PostgreSQL already belongs to the system and provides one global advisory lock shared by both bot containers. Analysis therefore has four layers of protection:

1. Sources may fetch concurrently, but expensive LLM analyses are sequential inside each run.
2. The PostgreSQL advisory lock permits only one Ollama analysis across both bots at a time.
3. `OLLAMA_MAX_ITEMS_PER_RUN` can cap how many new items are reserved and analyzed per run. The default `0` processes every new item found across all configured targets and sources.
4. Context, output length, timeout, retry count, thinking, and model keep-alive are bounded by environment variables.

The default prioritizes complete overnight runs over digest speed. Set `OLLAMA_MAX_ITEMS_PER_RUN` to a positive value if you need a hard safety cap after observing free RAM/VRAM and run duration. Lower `OLLAMA_KEEP_ALIVE` to `0` when RAM is scarce and slower model reloads are acceptable.

Also constrain the external Ollama service itself. For a Linux systemd installation, run `sudo systemctl edit ollama.service` and add:

```ini
[Service]
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_MAX_QUEUE=8"
Environment="OLLAMA_CONTEXT_LENGTH=4096"
```

Then run `sudo systemctl daemon-reload && sudo systemctl restart ollama`. These settings ensure another local client cannot silently increase model parallelism or load several models. The request-specific `OLLAMA_NUM_CTX` remains the Watcher-side limit. See the [official Ollama concurrency and queue documentation](https://docs.ollama.com/faq#how-does-ollama-handle-concurrent-requests).

Use `ollama ps`, `journalctl -u ollama --follow`, and host RAM/VRAM metrics during the first few runs. If Ollama shares the VPS with important services, additionally set systemd `MemoryHigh`, `MemoryMax`, or `CPUQuota` based on the server's actual capacity, always leaving headroom for PostgreSQL, Docker, and the operating system.

To add a source, implement the shared `Source<TConfig>` contract in the appropriate source package, validate the provider response at the HTTP boundary, normalize it into `WatchItem[]`, and keep the HTTP client injectable. Add the new database enum/config row, wire it into the relevant app's `watcher.ts`, expose its switch through `/sources`, and add normalization and failure-path tests. Commit a Prisma migration for schema changes.

## Repository layout

```text
apps/
  stocks-bot/             process lifecycle and stock Telegram workflows
  publications-bot/       process lifecycle and publication Telegram workflows
packages/
  core/                   pipeline, scheduling, run orchestration, common types
  database/               Prisma schema, migrations, client, persistence store
  llm/                    Ollama adapter, prompts, validation
  stock-sources/           SEC, feed, and price adapters
  publication-sources/     PubMed, bioRxiv, trials, and FDA adapters
  telegram/               authorization, parsing, keyboards, digest splitting
deploy/                    VPS/Tailscale/GHCR deployment configuration
```

## Production deployment

Production uses the shared image in GHCR, a private Compose network, a persistent PostgreSQL volume, pre-deploy backups, migrations, health-gated rollout, and application-image rollback. Ollama stays on the VPS host or another private machine. Runtime containers use read-only filesystems, so migrations run through the Prisma binary already packaged in the image instead of installing dependencies at startup.

The complete Tailscale OAuth, VPS SSH, known-hosts, GHCR, GitHub Environment, server credential-file, first-deploy, operations, backup, and troubleshooting instructions are in [deploy/README.md](deploy/README.md). The exact credential inventory is in [deploy/ENVIRONMENT.md](deploy/ENVIRONMENT.md); safe templates live under `deploy/presets` and in the two `deploy/github-*.example` files.

Real credentials belong only in the GitHub `production` environment or mode-`0600` files under `/opt/watcher/deploy/runtime`. They must never be committed.

## Security and operations

- PostgreSQL has no host port in either Compose definition.
- Application and migration containers run as a non-root user, with read-only filesystems, `no-new-privileges`, and a writable `/tmp` tmpfs.
- Both processes handle `SIGTERM` and `SIGINT`, stop polling, and disconnect from PostgreSQL.
- Logs redact known token, password, authorization, and database URL fields.
- A failed release preserves the previous healthy app image. Database migrations are not reversed, so migrations must remain backward-compatible with that image.

See `AGENTS.md` for the project constraints and completion contract for future changes.

## Troubleshooting

- **A bot exits immediately:** inspect `docker compose logs <service>`. Missing or malformed environment variables are rejected at startup.
- **A run returns source errors:** inspect `docker compose logs -f stocks-bot` or `docker compose logs -f publications-bot`. Look for `Watcher source failed` with its `source`, `target`, and error message. Temporarily set `LOG_LEVEL=debug` for per-item analysis logs.
- **Telegram does not respond:** confirm the correct token is assigned to the correct service, your numeric user ID is allowlisted, and no second process is polling the same bot token.
- **Ollama connection fails:** from the VPS, verify Ollama is listening beyond loopback when appropriate; from a temporary container, verify `host.docker.internal:11434` is reachable. Keep Ollama behind the host firewall or private network.
- **SEC fails:** provide an identifiable `SEC_USER_AGENT`, verify outbound HTTPS, and avoid lowering the built-in request spacing.
- **Migrations fail:** check `docker compose logs migrate`, verify the URL-encoded database password, and do not start the bots by bypassing the migration service.
- **A scheduled run did not send:** `/status` shows the persisted next run and last state. Empty scheduled runs are intentionally silent; `/run` reports an empty result.
- **Production rollout/Tailscale/SSH issues:** use the focused checklist in [deploy/README.md](deploy/README.md#troubleshooting).
