# Watcher

Watcher is a production-oriented, self-hosted, Telegram-only monitoring system for one operator. It runs independent TypeScript bot processes on one Linux server:

- **Stocks Watcher** monitors SEC filings, auto-discovered issuer feeds, GDELT news, TradingView symbol news, FINVIZ insider transactions, Zacks rank/quote snapshots, Earnings Whispers earnings snapshots, and price snapshots.
- **Publications Watcher** monitors PubMed, bioRxiv, ClinicalTrials.gov, and openFDA results.
- **News Watcher** runs Czech and Global editorial profiles through one shared RSS/Atom ingestion, deduplication, and ranking engine.
- **MU Clubs Monitor** checks verified public websites, Linktrees, and Instagram profiles for meaningful Brno/MUNI club activities and publishes qualifying items to the briefing event stream.
- **Personal Morning Briefing** consumes meaningful normalized events from the watcher producers, combines them with optional weather and read-only Google Calendar context, and delivers a scheduled or manual spoken briefing through Telegram.

The services share PostgreSQL and an external Ollama instance. There is no web UI, Redis, host cron, or bundled Ollama service. See [the Morning Briefing architecture and operations](docs/morning-briefing-architecture.md).

## How it works

Each source normalizes provider data into a common `WatchItem`; the persistence boundary records a richer normalized observation with source provenance and separate publication, discovery, and event timestamps. A run waits for all enabled targets and sources with `Promise.allSettled`, records individual source failures, reserves new items through PostgreSQL uniqueness constraints, analyzes only reserved items with Ollama, and persists the run result. Company and observation changes also produce append-only domain journal events. Already processed SEC filings, RSS/news entries, price snapshots, PubMed articles, bioRxiv papers, clinical trials, and FDA reports are skipped by stable source identity. Manual and scheduled runs use this exact same path.

Schedule state and overlap locks are stored in PostgreSQL. A stale lock is recoverable after two hours. Stock digests are sent only when a run contains a successful analysis or a new non-duplicate stock event; provider backoffs, source failures, and failed analyses remain available in structured logs and `/health` but do not create or clutter a stock digest. Scheduled runs stay silent when nothing useful is new, while a manual `/run` edits its progress message to report that no new content was found.

## Requirements

- Node.js 24
- pnpm 11.6.0
- Docker Engine with Docker Compose v2 for the recommended local and production paths
- Four private Telegram bots created with BotFather
- Ollama reachable from the bot containers, with the configured model already pulled
- An identifiable SEC user agent such as `Watcher/1.0 operator@example.com`
- An Alpha Vantage API key if market-wide stock discovery should be enabled

## Quick start with Docker Compose

1. Open `@BotFather` in Telegram, create one bot for each service, and keep the resulting tokens separate. Disable group access if the bots do not need it. To find your numeric Telegram user ID, call `https://api.telegram.org/bot<TOKEN>/getUpdates` once after messaging your new bot and read `message.from.id`. Put only trusted numeric IDs in `TELEGRAM_ALLOWED_USER_IDS`.

2. Copy the environment template and fill in real values:

   ```bash
   cp .env.example .env
   chmod 600 .env
   ```

3. Make sure Ollama accepts connections from Docker. On Linux and Docker Desktop, the default URL is `http://host.docker.internal:11434`. Pull the configured generation and embedding models first, for example `ollama pull qwen3.5:4b` and `ollama pull nomic-embed-text`.

4. Download the accepted Piper voice models, then build, migrate, and start all bots:

   ```bash
   PIPER_ACCEPT_VOICE_LICENSES=true ./deploy/download-piper-voices.sh
   docker compose up -d --build
   docker compose ps
   docker compose logs -f stocks-bot publications-bot news-bot mu-clubs-monitor briefing-bot
   ```

   The installer includes `cs_CZ-jirka-medium`. The Briefing Bot keeps the
   selected English voice for the main briefing and automatically switches to
   Jirka for Calendar event sentences detected as Czech, then joins every
   segment into one Opus voice message.

PostgreSQL uses the pinned `pgvector/pgvector:0.8.6-pg16-bookworm` image and is published only on host loopback as `127.0.0.1:5433`; it is not directly reachable from the public internet. Its data lives in the `watcher-postgres` named volume. The migration creates the `vector` extension automatically and deployment verifies it before starting applications. Briefing event embeddings are cached in PostgreSQL and used only as a secondary story-clustering signal inside a bounded time window; exact IDs, URLs, entities, categories, and explicit relationships remain authoritative. The one-shot `migrate` service must complete before applications start. For remote administration, use the SSH/Tailscale tunnel documented in `deploy/README.md`.

The bots emit structured JSON logs. At `LOG_LEVEL=info`, watcher runs record start, prepared source count, per-source fetch outcomes, source failures, notification sends, and completion counters. The briefing bot records commands, freshness-gate waits, semantic-clustering counts, context availability and latency, story-selection metrics, script and audio generation, Telegram delivery channels, and the final run duration. Each service exposes an internal `/healthz` readiness endpoint used by Compose; it verifies application startup and PostgreSQL, the Ollama-backed bots also verify Ollama, and Briefing additionally checks every Piper model file. Set `LOG_LEVEL=debug` to also log individual watcher item analysis, cached-analysis reuse, idle briefing scheduler checks, non-command Telegram updates, Piper chunks, and delivery attempts.

The Briefing Bot waits a bounded time for subscribed producers before a scheduled morning delivery, ranks fresh cross-source stories, calls out Calendar deadlines, overlaps, short gaps, and likely travel transitions, and ends with a short action agenda. Personal ranking is managed with `/priority_add TOPIC`, `/priority_remove TOPIC`, `/mute_add TOPIC`, and `/mute_remove TOPIC`; urgent stories are never hidden solely by a mute. Every delivered voice briefing has useful, less-useful, and too-long feedback buttons. A too-long rating idempotently reduces future target and maximum duration by one minute.

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
pnpm --filter @watcher/news-bot dev
pnpm --filter @watcher/mu-clubs-monitor dev
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

| Name                                                | Used by              | Meaning                                                                                       |
| --------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------- |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | PostgreSQL           | Local Compose database initialization                                                         |
| `DATABASE_URL`                                      | migrations, all bots | PostgreSQL connection URL                                                                     |
| `STOCKS_TELEGRAM_TOKEN`                             | stocks bot           | BotFather token for the stocks bot                                                            |
| `PUBLICATIONS_TELEGRAM_TOKEN`                       | publications bot     | BotFather token for the publications bot                                                      |
| `NEWS_TELEGRAM_TOKEN`                               | news bot             | Distinct BotFather token for the Czech and Global news profiles                               |
| `BRIEFING_TELEGRAM_TOKEN`                           | briefing bot         | Distinct BotFather token for the personal morning briefing bot                                |
| `MU_CLUBS_API_TOKEN`                                | MU Clubs monitor     | Bearer token protecting its activity, registry, briefing, and manual-run endpoints            |
| `MU_CLUBS_HOST`, `MU_CLUBS_PORT`                    | MU Clubs monitor     | Internal HTTP listener; Compose publishes port 4010 to host loopback only                     |
| `MU_CLUBS_MONITOR_INTERVAL_MINUTES`                 | MU Clubs monitor     | Scheduled monitor cadence                                                                     |
| `INSTAGRAM_CACHE_TTL_MINUTES`                       | shared Instagram     | Reuse window for public profile and post results                                              |
| `INSTAGRAM_MIN_REQUEST_INTERVAL_MS`                 | shared Instagram     | Minimum delay between public Instagram requests                                               |
| `INSTAGRAM_MAX_POSTS_PER_FETCH`                     | shared Instagram     | Hard cap on posts requested per profile                                                       |
| `TELEGRAM_ALLOWED_USER_IDS`                         | all bots             | Comma-separated Telegram numeric user IDs; every command and callback is denied unless listed |
| `OLLAMA_URL`                                        | all bots             | Ollama base URL                                                                               |
| `OLLAMA_MODEL`                                      | all bots             | Installed Ollama model name                                                                   |
| `OLLAMA_KEEP_ALIVE`                                 | all bots             | How long Ollama keeps the model loaded; defaults to `5m`                                      |
| `OLLAMA_MAX_ITEMS_PER_RUN`                          | watcher producers    | Maximum new items analyzed in one run; `0` means all new items and is the default             |
| `OLLAMA_NUM_CTX`                                    | watcher producers    | Per-request context size; defaults to `4096`                                                  |
| `BRIEFING_OLLAMA_NUM_CTX`                           | briefing bot         | Briefing script context size; defaults to `8192` without increasing producer requests         |
| `BRIEFING_EMBEDDING_MODEL`                          | briefing bot         | Ollama embedding model for secondary semantic story clustering; empty disables it             |
| `BRIEFING_EMBEDDING_MIN_SIMILARITY`                 | briefing bot         | Minimum cosine similarity for a semantic candidate; defaults to `0.82`                        |
| `BRIEFING_EMBEDDING_WINDOW_HOURS`                   | briefing bot         | Maximum time distance between semantic candidates; defaults to `96` hours                     |
| `BRIEFING_FRESHNESS_MAX_AGE_MINUTES`                | briefing bot         | Maximum accepted age of a producer run before scheduled delivery; defaults to `1560` minutes  |
| `BRIEFING_FRESHNESS_WAIT_TIMEOUT_MINUTES`           | briefing bot         | Maximum wait for stale producers before degraded delivery; defaults to `20` minutes           |
| `BRIEFING_FRESHNESS_POLL_INTERVAL_MS`               | briefing bot         | Poll interval while waiting for producer freshness; defaults to `30000` milliseconds          |
| `OLLAMA_NUM_PREDICT`                                | watcher producers    | Maximum generated tokens per analysis; defaults to `768`                                      |
| `OLLAMA_FULL_ANALYSIS_NUM_PREDICT`                  | stocks bot           | Output-token cap for the larger thesis/scenario response; defaults to `1536`                  |
| `OLLAMA_RETRIES`                                    | watcher producers    | Retry count after a failed or invalid response; defaults to `1`                               |
| `OLLAMA_THINK`                                      | watcher producers    | Enables model thinking output; defaults to `false` to avoid unnecessary compute               |
| `OLLAMA_TIMEOUT_MS`                                 | watcher producers    | Per-attempt timeout, from 10–180 seconds; defaults to 120 seconds                             |
| `SEC_USER_AGENT`                                    | stocks bot           | SEC-compliant app name and contact address                                                    |
| `DEFAULT_TIMEZONE`                                  | all bots             | IANA timezone used for a newly created watcher or briefing setting                            |
| `LOG_LEVEL`                                         | all bots             | Pino log level, normally `info`                                                               |
| `STOCK_EVENT_COOLDOWN_MINUTES`                      | stocks bot           | Same-event analysis cooldown; defaults to 360 minutes                                         |
| `STOCK_TICKER_ANALYSIS_COOLDOWN_MINUTES`            | stocks bot           | Same-ticker analysis cooldown; defaults to 30 minutes                                         |
| `SOURCE_BACKOFF_BASE_SECONDS`                       | watcher producers    | Initial source-failure backoff; defaults to 60 seconds                                        |
| `SOURCE_BACKOFF_MAX_MINUTES`                        | watcher producers    | Maximum exponential source backoff; defaults to 360 minutes                                   |
| `ALERT_ATTENTION_THRESHOLD`                         | stocks bot           | Attention score that creates a live alert when crossed; defaults to 85                        |
| `RECONCILIATION_INTERVAL_MINUTES`                   | stocks bot           | Interval for comprehensive recovery scans; defaults to one day                                |
| `VALIDATION_MIN_SAMPLE_SIZE`                        | stocks bot           | Completed 30-day samples required to mark signal statistics adequate; defaults to 20          |
| `ALPHA_VANTAGE_API_KEY`                             | stocks bot           | Optional Alpha Vantage key for discovery and institutional holdings                           |
| `ALPHA_VANTAGE_OPTIONS_ENABLED`                     | stocks bot           | Enables premium realtime option-chain requests; defaults to `false`                           |
| `QUIVER_API_TOKEN`                                  | stocks bot           | Optional Quiver bearer token; leaving it empty disables Quiver requests                       |
| `PRICE_ANOMALY_THRESHOLD_PERCENT`                   | stocks bot           | Absolute daily-return anomaly threshold; defaults to 4%                                       |
| `GAP_ANOMALY_THRESHOLD_PERCENT`                     | stocks bot           | Absolute opening-gap anomaly threshold; defaults to 3%                                        |
| `RELATIVE_VOLUME_ANOMALY_THRESHOLD`                 | stocks bot           | Relative-volume anomaly multiplier; defaults to 3                                             |
| `VOLATILITY_EXPANSION_THRESHOLD`                    | stocks bot           | Current-move versus historical-volatility multiplier; defaults to 2                           |
| `MARKET_BASELINE_MIN_SNAPSHOTS`                     | stocks bot           | Minimum stored volume snapshots before relative-volume detection; defaults to 5               |
| `OPTIONS_VOLUME_OI_ANOMALY_THRESHOLD`               | stocks bot           | Contract option-volume/open-interest anomaly ratio; defaults to 2                             |
| `OPTIONS_VOLUME_BASELINE_MULTIPLIER`                | stocks bot           | Aggregate options-volume anomaly versus recent baseline; defaults to 3                        |
| `OPTIONS_BASELINE_MIN_SNAPSHOTS`                    | stocks bot           | Prior option snapshots required for an aggregate-volume baseline; defaults to 3               |
| `INSTITUTIONAL_CHANGE_THRESHOLD_PERCENT`            | stocks bot           | Absolute institutional holdings-change threshold; defaults to 5%                              |
| `SHORT_INTEREST_CHANGE_THRESHOLD_PERCENT`           | stocks bot           | Absolute reported short-interest change threshold; defaults to 10%                            |
| `SHORT_INTEREST_DAYS_TO_COVER_THRESHOLD`            | stocks bot           | Days-to-cover threshold for a short-interest anomaly; defaults to 5                           |
| `DISCOVERY_MARKET_DATA_ENTITLEMENT`                 | stocks bot           | `EOD`, `DELAYED`, or `REALTIME`; must match the key's market-data entitlement                 |
| `DISCOVERY_SCAN_INTERVAL_MINUTES`                   | stocks bot           | Market-wide scan interval; defaults to one day                                                |
| `DISCOVERY_MOVE_THRESHOLD_PERCENT`                  | stocks bot           | Minimum absolute move for a discovery candidate; defaults to 4%                               |
| `DISCOVERY_MIN_PRICE`                               | stocks bot           | Minimum candidate price; defaults to 2                                                        |
| `DISCOVERY_MIN_VOLUME`                              | stocks bot           | Minimum current snapshot volume; defaults to 100,000                                          |
| `DISCOVERY_MIN_DOLLAR_VOLUME`                       | stocks bot           | Minimum price × volume; defaults to 1,000,000                                                 |
| `DISCOVERY_MAX_CANDIDATES`                          | stocks bot           | Maximum candidates investigated per market-wide scan; defaults to 10                          |
| `DISCOVERY_SUPPORTED_EXCHANGES`                     | stocks bot           | Comma-separated SEC exchange names accepted by discovery                                      |
| `DISCOVERY_EXCLUDE_OTC`                             | stocks bot           | Reject SEC profiles whose exchange contains `OTC`; defaults to true                           |
| `DISCOVERY_INVESTIGATION_MINUTES`                   | stocks bot           | Time allowed for a temporary investigation; defaults to 90 minutes                            |
| `DISCOVERY_HIGH_RESOLUTION_INTERVAL_MINUTES`        | stocks bot           | Interval for SEC/IR/GDELT/TradingView/price checks while escalated; defaults to 5 minutes     |
| `DISCOVERY_EVENT_MODE_MINUTES`                      | stocks bot           | Duration of event-mode polling after material evidence; defaults to 120 minutes               |
| `DISCOVERY_WATCH_DAYS`                              | stocks bot           | Watch lifetime after automatic promotion; defaults to 14 days                                 |

Infrastructure secrets cannot be edited through Telegram. Telegram-editable schedules, watchlists, query lists, news feeds/topics, and source switches are persisted in PostgreSQL.

## Telegram commands

Stocks and Publications support `/about`, `/start`, `/help`, `/status`, `/list_sources`, `/schedule [CRON] [TIMEZONE]`, `/run`, `/pause`, and `/resume`. News supports the common lifecycle commands plus profile-aware feed and topic configuration. `/help` prints an alphabetized command list, while `/about` explains each bot's purpose and workflow.

Manual `/run` requests first send one progress message, then update that message with `editMessageText` while sources are fetched, items are prepared, and Ollama analyses run. Run digests use Telegram formatting with clear item separators, labeled summary and detail sections, bullet lists, source links, and total run time. Link previews are disabled to keep multi-item digests compact.

Stocks bot:

- `/stocks` to show labeled per-stock state plus currently watched, configured, paused, and auto-discovered counts
- `/dashboard` to show the latest state of every enabled stock
- `/opportunities` to show elevated-attention or favorable-asymmetry stocks
- `/alerts` to show recent generated alerts and delivery state
- `/health` to show run, reconciliation, source, LLM, latency, and queue metrics
- `/replay SYMBOL DATE` for a strict historical as-of view that excludes later-known information
- `/event_replay SYMBOL [FROM] [TO]` for the chronological event and thesis-transition stream
- `/validate` to match stored theses, alerts, and signals to stored price outcomes
- `/backtest`, `/calibration`, and `/signal_performance` for validation reports
- `/reconcile` to run the comprehensive recovery scan now
- `/catalysts [SYMBOL]` to list active and upcoming catalyst records with evidence
- `/advanced [SYMBOL]` to inspect the latest options, institutional, short-interest, FDA, and clinical-trial data
- `/thesis SYMBOL` to show the latest persistent thesis, decision state, scenarios, coverage, and signal scores
- `/discovery` to show scanner state, active investigations, and recent signals
- `/run_discovery` to run the configured cheap market-wide scanner immediately
- `/add_stock SYMBOL`
- `/remove_stock SYMBOL`
- `/set_tier SYMBOL TIER [YYYY-MM-DD] [REASON]`
- `/set_mode SYMBOL MODE`
- `/set_priority SYMBOL 0-100`
- `/stock_on SYMBOL` and `/stock_off SYMBOL`
- `/sources` to toggle each stock source globally for all current and future stocks, including advanced and optional Quiver datasets
- `/list_sources` to list available stock sources and provider links

Publications bot:

- `/queries`
- `/add_query TOPIC`
- `/add_queries` to import multiple topics from a CSV attachment
- `/remove_query TOPIC`
- `/sources` to toggle PubMed, bioRxiv, ClinicalTrials.gov, and openFDA globally for all current and future queries
- `/list_sources` to list available publication sources and provider links

News bot:

- `/feed_add PROFILE URL [NAME]`, `/feed_remove ID`, `/feed_enable ID`, and `/feed_disable ID`
- `/feeds` to list Czech and Global feeds with their stable IDs
- `/topic_add PROFILE TOPIC`, `/topic_remove PROFILE TOPIC`, and `/topics`
- `/run` to process both profiles, or `/run czech` / `/run global` for one profile
- `/schedule`, `/status`, `/pause`, and `/resume` for the shared persisted runner

MU Clubs monitor:

- `GET /activities` lists persisted normalized club activities; filters include `since`, `club`, `minImportance`, and `limit`
- `GET /briefing` returns the last 24 hours of briefing-worthy activities by default
- `GET /clubs` shows active, unsupported, and excluded club/source registry entries
- `POST /run` invokes the same source pipeline used by the scheduler
- These endpoints require `Authorization: Bearer $MU_CLUBS_API_TOKEN`; only `GET /healthz` is unauthenticated

Personal Morning Briefing bot:

- `/start` to begin or resume persisted onboarding; Google Calendar is an optional integration and does not block setup
- `/briefing` and `/briefing_test` to generate a full or short briefing now
- `/briefing_settings`, `/briefing_time HH:mm[;HH:mm|weekly:DAY:HH:mm]`, `/briefing_duration MINUTES`, `/briefing_max_duration MINUTES`, and `/briefing_transcript on|off`
- `/subscriptions`, `/subscribe WATCHER`, `/unsubscribe WATCHER`, `/subscribe_all`, and `/unsubscribe_all`
- `/location_set CITY`, `/location_clear`, and `/location_status`
- `/voice_list`, `/voice_set VOICE`, and `/voice_preview VOICE`
- `/calendar_connect`, `/calendar_status`, `/calendar_refresh`, and `/calendar_disconnect`

Multiword Telegram command names use underscores. Legacy concatenated stock/publication names remain accepted as aliases, and legacy briefing commands typed with hyphens are normalized to their underscore equivalents.

Manual and test briefings can run with the saved settings and safe defaults before onboarding is complete. Scheduled delivery starts only after onboarding is completed. Google Calendar is optional; an unconnected calendar simply contributes no calendar events. The briefing scheduler uses the configured IANA timezone and a PostgreSQL claim, while manual/test runs have independent windows. Delivery schedules accept semicolon-separated local times, plus weekly entries in `weekly:DAY:HH:mm` format where `DAY` is `MON` through `SUN`; weekly entries use a 7-day briefing window and win over daily entries at the same local time. The default is `07:00;20:00;weekly:MON:07:00;weekly:SUN:20:00`, which gives normal morning/evening briefings plus full-week briefings on Monday morning and Sunday evening. Use `/briefing_time default` to restore it. Every run derives morning, afternoon, evening, or night from the user's configured timezone and local generation time; the spoken greeting, closing, watch horizon, and Telegram caption use that period even if the LLM suggests a mismatched greeting. Evening and night runs are end-of-day briefings: normal daily runs recap watcher developments from the current local day, retain relevant stories already mentioned earlier that day, and then present tomorrow's Calendar and preparation agenda. Explicit weekly windows remain weekly. Morning and afternoon runs use today's Calendar. The bot collects the newest subscribed watcher events in the briefing window before clustering and ranking, so large producer batches cannot push fresh developments out of the candidate set. It clusters related Stocks, Medical, News, and MU Clubs events, suppresses unchanged stories outside end-of-day recaps, selects to a variable spoken-word budget, and uses Piper for OGG/Opus audio. The compact index is included in the voice caption, so a successful delivery sends only one message unless the optional transcript is enabled. Failed weather, Calendar, script, TTS, source, or Telegram stages degrade independently. Voice upload exhaustion falls back to text. Every run persists producer health, enabled-input coverage, selection/noise counts, stage latency, voice, word count, planned duration, audio duration, and delivery failures.

Stock and publication source switches are global within their respective bot. Every source is enabled initially; `/sources` changes it for all current entries and saves the same setting for entries added later. Cron expressions use five fields; an optional final IANA timezone may be supplied. In the stocks bot, `/schedule_list` shows numbered schedules, `/schedule_add CRON` appends one in the current timezone, and `/schedule_remove NUMBER` removes one without replacing the others. Use `/pause` instead of removing the final schedule. `/schedule` remains the replace-all command and can also change the shared timezone: `/schedule 0 8 * * * Europe/Prague`. Multiple expressions can be supplied at once with semicolons, for example `/schedule 0 7 * * 1-5; 30 8 * * 1-5; 0 20 * * 1-5 America/New_York`.

### Stocks

The watchlist starts empty. `ELAN`, `CVS`, `NVO`, `PFE`, and `BMY` are examples only; none is seeded or mandatory. Add only the symbols you want with `/add_stock`. When a stock is added, Watcher resolves the ticker through SEC EDGAR, stores the company name and CIK, and shows the company name in `/stocks` and stock run digests. Confirmed upcoming quarterly earnings dates for watched stocks produce Morning Briefing reminders one week before and one day before the report date.

Available stock sources are SEC EDGAR, issuer RSS/Atom feeds auto-discovered from SEC company metadata, GDELT news discovery, TradingView symbol news, FINVIZ insider transactions, Zacks rank/quote snapshots, Earnings Whispers earnings snapshots, Stooq price, FINRA short interest, ClinicalTrials.gov, openFDA Drugs@FDA, Alpha Vantage institutional/options data, and six optional Quiver datasets. Every source switch is enabled initially. Credential-backed switches remain dormant when their server credential or entitlement flag is absent. Provider URLs are built into the bot; use `/sources` to change a source globally for all existing stocks and as the default for stocks added later.

Each company has an independent monitoring tier (`CORE`, `WATCH`, `DISCOVERY`, or `INVESTIGATE`), monitoring mode (`LOW_RESOLUTION`, `NORMAL`, `HIGH_RESOLUTION`, or `EVENT_MODE`), priority, enabled state, optional watch reason, and optional expiry date. Phase 3 adds automatic lifecycle transitions and temporary high-resolution checks without changing the normal watcher cron.

When `ALPHA_VANTAGE_API_KEY` is configured, a persisted market-wide schedule reads Alpha Vantage's top gainers, losers, and most-active snapshot without using Ollama. Price, current volume, dollar-volume, ticker-format, SEC resolution, supported-exchange, and OTC filters reduce low-quality candidates. Selected names are persisted as `INVESTIGATE/HIGH_RESOLUTION`, receive an immediate run across all enabled sources, and then receive SEC/IR/GDELT/TradingView/price checks at the high-resolution interval. A high/extreme canonical event first observed by that watcher promotes the name to `WATCH/EVENT_MODE`; an unexplained investigation expires back to `DISCOVERY/LOW_RESOLUTION`. Watch expiry is extended only by a newer material event, otherwise the company returns to discovery. Provider snapshot identity and PostgreSQL constraints prevent the same market snapshot from starting the same investigation twice.

Stock observations now pass through Phase 2 event intelligence before Ollama. Watcher creates canonical events, merges cross-source confirmations, records primary evidence and event chains, computes materiality relative to stored company scale when structured amounts are available, and applies persisted event/ticker cooldowns. Routine Form 4/Form 144 observations are retained as low-materiality state updates without an LLM call. Digests show event decisions, duplicate/cooldown counts, and source data coverage.

Phase 4 adds structured insider classification and conviction scoring, 30-day purchase-cluster detection, a persistent catalyst registry, stored market baselines, price/gap/volume/volatility anomalies, and unknown-cause investigation escalation. Form 4 facts from SEC, FINVIZ, and Quiver share one classifier and fingerprint, so confirmations do not multiply the signal. Market anomalies never receive a bullish/bearish direction merely from price or volume; they are linked to a recent material event when one exists and otherwise remain explicitly unexplained. `/catalysts` exposes the active registry, including timing, impact, direction, and primary evidence.

Phase 5 adds targeted event analysis, primary-driver/redundancy classification, weighted signal groups, source-aware data coverage, change detection, and persistent versioned thesis state. Full Ollama analysis is skipped when targeted analysis finds no meaningful thesis change. `/thesis SYMBOL` shows the latest thesis, confidence, attention, bull/bear/net scores, catalysts, risks, and material data gaps.

Phase 6 adds validated bull/base/bear scenarios, broad probability ranges, scenario-weighted expected value, asymmetry, priced-in analysis, deterministic recommendation gates, and conservative maximum position ranges. Missing data never becomes neutral evidence: coverage below 50%, confidence below 45%, or absent probability support produces `INSUFFICIENT_DATA` and a 0% suggested position. Every result requires human review and is not an automatic trade instruction.

Phase 7 adds durable live alerts for high/extreme events, threshold crossings, thesis/verdict/asymmetry changes, insider clusters, extreme catalysts, and unexplained activity. Alert generation is unique per watcher/event, delivery failures remain pending for retry, and every alert links to its evidence while explicitly avoiding leak or guaranteed-trade claims. A persisted daily reconciliation runs the same source and deduplication pipeline, clears expired source backoff for a recovery attempt, and analyzes only meaningful new canonical events. Telegram `/dashboard`, `/opportunities`, `/alerts`, and `/health` provide the operational and decision overview without adding a web UI.

Phase 8 adds persisted option-chain positioning, institutional holdings, FINRA consolidated short interest, company-matched ClinicalTrials.gov studies, openFDA Drugs@FDA submissions, and Quiver lobbying. Deterministic thresholds suppress ordinary positioning snapshots before Ollama; unusual options and short-interest activity remains direction-unknown and delayed institutional reports do not imply current intent. Credential-backed sources that are not actually instantiated are excluded from thesis data coverage. See [the Phase 8 design](docs/stock-intelligence-phase-8.md).

Phase 9 adds strict historical and chronological event replay plus persisted outcome validation for theses, alerts, and individual signal types. Backtests report stored 1-hour, 1/7/30/90-day, and 12-month returns together with hit rate, mean/median return, MFE, and MAE; unavailable horizons remain unavailable. Probability calibration uses fixed 30-day buckets, and low-sample signal groups are clearly marked instead of being used to tune weights automatically. See [the Phase 9 design](docs/stock-intelligence-phase-9.md).

### Publications

The query list also starts empty. Add a topic such as `/add_query mycorrhizal fungi`; it is stored exactly for display and in normalized form for duplicate protection. To import many topics, upload a CSV file with a `query` or `topic` column and reply to it with `/add_queries`, or attach the CSV with `/add_queries` as the document caption. If no header is present, the first column is used. PubMed, bioRxiv, ClinicalTrials.gov, and openFDA are enabled initially. Use `/sources` to disable or enable a provider globally for all existing queries and as the default for queries added later.

### News

News feeds and topics start empty; no editorial source list is imposed. Add public RSS or Atom URLs to either the `czech` or `global` profile. Topics steer relevance ranking within that profile; if a profile has no topics, Ollama assesses general public significance. Feed responses are normalized and deduplicated through the shared watcher pipeline, while important and relevant stories are published to the Briefing Bot as durable `news` events. Enable or disable the `news` subscription from the Briefing Bot independently of the News Watcher's own schedule.

## Source support and limitations

- **SEC EDGAR:** fetches the company ticker directory, recent submissions, and filing documents. `SEC_USER_AGENT` is mandatory and requests are paced. The MVP checks recent filings only.
- **Investor relations:** reads the issuer URL exposed by SEC submissions metadata, safely auto-discovers an advertised RSS/Atom feed, and consumes it when present. If the issuer exposes no URL or feed, this source returns no items.
- **News:** queries the hardcoded public GDELT DOC 2.0 article-list endpoint for recent English-language mentions of the company. GDELT supplies discovery metadata and headlines, not licensed full article text or a finance-specific availability SLA.
- **TradingView News:** queries TradingView's symbol headline feed for each watched stock using the exchange-qualified ticker, then links to the TradingView story page and uses available article-page text as analysis context. TradingView HTML or headline endpoints may change or throttle automated requests.
- **FINVIZ:** reads the public ticker quote page's insider-trading table and normalizes up to five recent rows. It links each result to the underlying SEC filing. FINVIZ HTML may change or throttle automated requests.
- **Zacks:** reads the public JSON quote feed used by the ticker page and emits a new snapshot when its visible Zacks Rank or quote facts change. The snapshot includes rank, price/change, forward P/E, and confirmed earnings date when provided. It does not access subscriber-only reports.
- **Earnings Whispers:** establishes the anonymous session used by the public ticker page, then reads its public earnings endpoints. It combines the next earnings date and estimates with the latest reported EPS/revenue surprise into one snapshot. It does not access subscriber-only data; the public endpoints may change or throttle automated requests.
- **Alpha Vantage discovery:** uses the documented `TOP_GAINERS_LOSERS` endpoint as an optional aggregate market scanner. The default `EOD` mode is appropriate for daily discovery; delayed or real-time operation requires the matching provider entitlement. This endpoint does not provide market capitalization or historical average volume, so Phase 3 filters current snapshot liquidity and exchange eligibility instead of inventing those values. See the [official Alpha Vantage API documentation](https://www.alphavantage.co/documentation/).
- **Alpha Vantage advanced data:** institutional holdings use `INSTITUTIONAL_HOLDINGS` when an API key exists. Realtime option chains use `REALTIME_OPTIONS` only when `ALPHA_VANTAGE_OPTIONS_ENABLED=true`; the provider marks realtime options as premium. API responses are aggregated locally and the key is never stored in observations or URLs.
- **FINRA short interest:** uses FINRA's public consolidated-short-interest dataset with an exact ticker filter. Reports are periodic and delayed, so a change or high days-to-cover value is contextual rather than a directional trade signal.
- **ClinicalTrials.gov / openFDA:** company-name searches use official APIs for sponsor/collaborator trials and Drugs@FDA submissions. Corporate aliases and subsidiaries can cause incomplete matches; no result is treated as missing data.
- **Quiver Quantitative:** optional bearer-authenticated adapters use the documented insider, government-contract, patent, congressional-trading, off-exchange, and lobbying endpoints. Provider observations are secondary evidence and context, not automatic buy/sell signals. SEC Form 4 observations outrank matching Quiver insider rows as primary evidence. Access tier, retention, redistribution, and polling frequency must follow the operator's current Quiver subscription and terms. See the [official Quiver API documentation](https://api.quiverquant.com/docs/) and [terms](https://www.quiverquant.com/termsofservice/).
- **PubMed:** uses NCBI E-utilities search and XML fetch endpoints.
- **Price:** uses Stooq's public CSV endpoint and creates a new item based on the returned trading date.
- **bioRxiv:** queries the official API over a recent date window and filters matching title/abstract text.
- **ClinicalTrials.gov:** uses the v2 structured API.
- **openFDA:** searches drug adverse-event reports by generic drug name; a provider 404 is treated as no results.
- **News RSS/Atom:** reads only operator-configured public feed URLs. Initial URLs and every redirect are checked against private, loopback, link-local, and special-purpose network targets. Analysis uses the feed-provided title and summary; it does not scrape arbitrary linked article pages.

External APIs can change, throttle, or return incomplete data. One source failure does not cancel other source results and is included in the run record and digest. Requests are coordinated by a shared limiter for each provider: GDELT is queried serially with at least five seconds between starts, PubMed serializes every NCBI E-utilities request at no more than one per second, bioRxiv reuses one provider response across all queries for 30 minutes, and all Alpha Vantage or Quiver adapters share their provider's queue. The first rate-limit response pauses queued calls for that provider, honors `Retry-After` when supplied, and persists the provider-wide backoff so later runs and other Telegram users do not immediately retry it. Other source failures retain bounded target-specific exponential backoff; a later successful check restores healthy status. The system does not invent fallback content.

Ollama responses are requested as structured JSON and validated with Zod. The parser safely extracts JSON from Markdown fences or leading commentary. Malformed output gets a small bounded corrective retry containing the validation problem and twice the previous output-token budget, up to 8192 tokens. `done_reason`, token counts, and unfinished JSON structure distinguish truncation so the repair prompt can say that the response was cut off. Publication output also normalizes safe model deviations such as known field aliases, a single string where a string array is required, numeric strings, and decimal or out-of-range scores. It does not invent missing summaries or scores; persistent failures are stored as failed analyses instead of crashing the run. Source content is truncated before it is sent to the model.

## Ollama resource protection

Watcher intentionally does not use Redis for Ollama coordination. PostgreSQL already belongs to the system and provides one global advisory lock shared by both bot containers. Analysis therefore has five layers of protection:

1. Sources may fetch concurrently, but expensive LLM analyses are sequential inside each run.
2. The PostgreSQL advisory lock permits only one Ollama analysis across watcher producers at a time.
3. Canonical event deduplication, materiality, and persisted cooldowns reject redundant or low-value stock work before Ollama.
4. `OLLAMA_MAX_ITEMS_PER_RUN` caps eligible analyses after the stock materiality gate. The default `0` processes every eligible event (and every new publication item).
5. Context, output length, timeout, retry count, thinking, and model keep-alive are bounded by environment variables.

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

The architecture review and phased checklist are in [docs/stock-intelligence-phase-1.md](docs/stock-intelligence-phase-1.md). Canonical events, materiality, cooldown, and source-health behavior are documented in [docs/stock-intelligence-phase-2.md](docs/stock-intelligence-phase-2.md). Market discovery and automatic lifecycle behavior are documented in [docs/stock-intelligence-phase-3.md](docs/stock-intelligence-phase-3.md).

Specialized insider, catalyst, market-anomaly, unexplained-movement, and Quiver behavior is documented in [docs/stock-intelligence-phase-4.md](docs/stock-intelligence-phase-4.md).

Targeted analysis and persistent thesis behavior are documented in [docs/stock-intelligence-phase-5.md](docs/stock-intelligence-phase-5.md). Scenario and decision behavior are documented in [docs/stock-intelligence-phase-6.md](docs/stock-intelligence-phase-6.md).

Live alerts, daily reconciliation, Telegram dashboards, and observability are documented in [docs/stock-intelligence-phase-7.md](docs/stock-intelligence-phase-7.md).

## Repository layout

```text
apps/
  stocks-bot/             process lifecycle and stock Telegram workflows
    src/core/              stock discovery, event intelligence, monitoring, and specialized signals
    src/sources/           SEC, market, feed, and alternative-data adapters
  publications-bot/       process lifecycle and publication Telegram workflows
    src/sources/           PubMed, bioRxiv, trials, and FDA adapters
  mu-clubs-monitor/       public club activity monitoring, API, classification, and scheduling
packages/
  core/                   cross-bot pipeline, event bus, scheduling, networking, and common types
  database/               Prisma schema, migrations, client, persistence store
  sources/                reusable source infrastructure: Instagram, safe public HTML, discovery, and caching
  llm/                    Ollama adapter, prompts, validation
  telegram/               authorization, parsing, keyboards, digest splitting
deploy/                    VPS/Tailscale/GHCR deployment configuration
```

## Production deployment

Production uses the shared image in GHCR, a private Compose network, a persistent PostgreSQL volume, pre-deploy backups, migrations, health-gated rollout, and application-image rollback. Ollama stays on the VPS host or another private machine. Runtime containers use read-only filesystems, so migrations run through the Prisma binary already packaged in the image instead of installing dependencies at startup.

The complete Tailscale OAuth, VPS SSH, known-hosts, GHCR, GitHub Environment, server credential-file, first-deploy, operations, backup, and troubleshooting instructions are in [deploy/README.md](deploy/README.md). The exact credential inventory is in [deploy/ENVIRONMENT.md](deploy/ENVIRONMENT.md); safe templates live under `deploy/presets` and in the two `deploy/github-*.example` files.

Real credentials belong only in the GitHub `production` environment or mode-`0600` files under `/opt/watcher/deploy/runtime`. They must never be committed.

## Security and operations

- PostgreSQL binds host port `5433` to loopback only. Remote administration requires an authenticated SSH/Tailscale tunnel; the database is never bound to a public interface.
- Application and migration containers run as a non-root user, with read-only filesystems, `no-new-privileges`, and a writable `/tmp` tmpfs.
- Both processes handle `SIGTERM` and `SIGINT`, stop polling, and disconnect from PostgreSQL.
- Logs redact known token, password, authorization, and database URL fields.
- A failed release preserves the previous healthy app image. Database migrations are not reversed, so migrations must remain backward-compatible with that image.

See `AGENTS.md` for the project constraints and completion contract for future changes.

## Troubleshooting

- **A bot exits immediately:** inspect `docker compose logs <service>`. Missing or malformed environment variables are rejected at startup.
- **A run returns source errors:** inspect the owning service, for example `docker compose logs -f stocks-bot`, `publications-bot`, or `mu-clubs-monitor`. Look for the structured source failure and its error message. Temporarily set `LOG_LEVEL=debug` for additional diagnostics.
- **Telegram does not respond:** confirm the correct token is assigned to the correct service, your numeric user ID is allowlisted, and no second process is polling the same bot token.
- **Ollama connection fails:** from the VPS, verify Ollama is listening beyond loopback when appropriate; from a temporary container, verify `host.docker.internal:11434` is reachable. Keep Ollama behind the host firewall or private network.
- **SEC fails:** provide an identifiable `SEC_USER_AGENT`, verify outbound HTTPS, and avoid lowering the built-in request spacing.
- **Migrations fail:** check `docker compose logs migrate`, verify the URL-encoded database password, and do not start the bots by bypassing the migration service.
- **A scheduled run did not send:** `/status` shows the persisted next run and last state. Empty scheduled runs are intentionally silent; `/run` reports an empty result.
- **Production rollout/Tailscale/SSH issues:** use the focused checklist in [deploy/README.md](deploy/README.md#troubleshooting).
