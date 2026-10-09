# Watcher

## OSINT Telegram bot

`apps/osint-bot` is a private Telegram investigation bot. It accepts Czech free text such as `Jakub Vantuch`, `Zjisti firmu, IČO 25301632`, public domains such as `Prověř example.cz`, and explicitly labelled addresses or public identifiers. Public property selectors include `adresa: Česká 1, Brno`, `parcela: CP.2131099101`, `parcela: 730190 188` (cadastral-area code plus parcel number), `budova: 21645736` (RÚIAN building code), `budova: BU.2267001`, and `katastr: Stachy`. It persists investigations, selectors, source evidence, entities, observations, provenance-backed relationships, source failures, chat context, and watch state in the existing PostgreSQL database. A person or company name is searched as a candidate in ARES, Registr smluv, and Wikipedia; IČO values discovered by the official ARES result automatically start one bounded follow-up wave against the IČO collectors. A name match remains a candidate and is never presented as confirmed identity. Public-register birth dates and residential addresses are deliberately discarded, and a domain is not inferred to belong to a company merely because both appear in one query.

Set a **separate** `OSINT_TELEGRAM_TOKEN` and `TELEGRAM_ALLOWED_USER_IDS` before deployment. For production, copy [the OSINT preset](deploy/presets/osint-bot.env.example) to a private mode-`0600` `deploy/runtime/osint-bot.env` and populate its token and database URL. The standard deployment validates these values, runs migrations, starts OSINT, and waits for its readiness health check; missing values fail the release. For local Compose, fill the OSINT variables in a private env file and run `WATCHER_ENV_FILE=<path> docker compose up -d`. `OLLAMA_URL` and `OLLAMA_MODEL` remain optional: when configured, `/report` may add separately labeled, source-ID-checked inference/hypothesis text **after** deterministic evidence collection; LLM output never becomes a stored fact.

Commands: `/investigate <query>`, `/investigations`, `/investigation [id]`, `/evidence [id]`, `/entity <id>`, `/relations [id]`, `/timeline [id]`, `/expand <selector/entity-id>`, `/report [id]`, `/watch [id]`, `/unwatch [id]`, `/status`, `/sources`, `/pause [id]`, `/resume [id]`, `/stop [id]`, `/about` (also `/osint_about`), `/help`. Follow-up text such as `Prověř jednatele`, `Ukaž vztahy`, `Udělej timeline` and `Sleduj tuto firmu` uses the saved chat context. Watches recheck daily by default and notify only when normalized evidence changes. Collector count is capped across all waves by `OSINT_MAX_COLLECTORS` (default 12); polling frequency is `OSINT_WATCH_POLL_MINUTES` (default 5). `OSINT_HEALTH_PORT` defaults to `4060` inside the container. The bot registers its command menu with Telegram at startup.

Implemented collectors include ARES name/IČO/public-register/CEÚ, Registr smluv, RÚIAN address standardization, and the official ČÚZK INSPIRE WFS services for address places, cadastral parcels, buildings, and cadastral areas. RÚIAN may discover an address-place ID and building code; ČÚZK resolves that code with `GetBuildingByFacilityCode`, the building may discover a parcel, and the parcel may discover its cadastral area within the investigation's bounded depth and collector budget. These collectors retain public technical identifiers, area and registry relationships, not owner identities; Nahlížení do KN is not scraped and CAPTCHA is never bypassed. Other collectors cover public website metadata, DNS, RDAP via IANA bootstrap, Certificate Transparency, Wayback CDX, Wikipedia, GitHub, Reddit, ORCID, Crossref, explicit public LinkedIn/X/YouTube metadata, exact public website evidence for an e-mail address, and public Bitcoin/Ethereum explorer summaries. `/sources` is the live in-bot inventory with supported selector syntax and limitations. Direct Justice PDF extraction and the complete ISIR SOAP stream are not yet implemented; CEÚ and the ARES public-register endpoint cover only their structured subset. Phone-number reverse lookup remains unsupported because the bot has no safe, free authoritative source. Unsupported selectors are reported rather than answered from invented data. See [architecture and explicit limitations](docs/osint-architecture.md).

## Personal Network Bot

The private sales Telegram bot can also manage a personal professional network in an existing private Google Sheet. It uses the official Google Sheets API behind a `NetworkRepository`; matching, duplicate detection, business-card parsing, and Telegram handlers do not depend directly on Google APIs. The sheet tab and its eight headers must be exactly:

`Name | Datum potkání | Místo potkání | Kontakt | Poznámka k potkání | Typ kontaktu | Domluvena další schůzka | Aktivní kontakt`

No hidden or extra ID column is required. Telegram details use the current sheet row as a temporary ID, so request the detail again after manually sorting or deleting rows. `Kontakt` holds the available e-mail, phone, web, LinkedIn, company, and role text. Professional skills, what the person can help with, and what they seek belong in `Poznámka k potkání`; `Typ kontaktu` can hold a concise category. This preserves the supplied table instead of silently migrating it.

Enable the Google Sheets API in a Google Cloud project, create a dedicated service account, and share only the target spreadsheet with its service-account e-mail as an editor. Set `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SHEETS_NETWORK_RANGE=Network!A:H`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, and `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` in the private sales-bot environment file. Store the PEM key on one line with literal `\n` sequences; never paste it into Telegram or commit it. The bot validates the header row before reading or writing. Leave the spreadsheet ID, service-account e-mail, and private key empty to disable Network Bot cleanly.

With `OLLAMA_URL` and `OLLAMA_MODEL`, manual capture, updates, and search use structured, Zod-validated Czech/English extraction and semantic ranking. Without Ollama, records can still be prepared and searched with a deterministic lexical fallback, but natural-language updates are unavailable. Set `NETWORK_OLLAMA_VISION_MODEL` to a locally installed Ollama model that supports images to enable business-card photos. The parser stores only visible contact-card facts and asks for meeting context before confirmation. Contacts are never saved silently: `/network_add` and card photos create a preview, run duplicate checks, and require the operator to press **Uložit**. Potential duplicates are matched by normalized name, e-mail, phone, and LinkedIn URL.

Commands: `/network_help`; `/network_add <description>`; `/network_search <query>`; `/network_contact <name or row ID>`; `/network_update <name or row ID> | <single change>`; `/network_intro <name or row ID>`; `/network_followups`; and `/network_context <place> | <note> | <type> | <next meeting> | <yes/no>`. Ordinary Czech or English text that is not a command is treated as a network search. The bot returns up to five people with honest match labels and grounded reasons. It recommends introductions but never contacts anyone automatically.

## Sales-bot MVP

Start the VPS configuration from `deploy/presets/sales-bot.env.example`, `deploy/presets/quickly.env.example`, and `deploy/presets/twenty.env.example`; keep populated copies only in `deploy/runtime`.

`apps/sales-bot` is a lead-research and outreach service started by the standard deployment. `/sales_search <service> | <location> | <limit>` combines the free public ARES API with Geoapify: ARES finds active Czech legal subjects by a resolved CZ-NACE code or business name and registered address, while Geoapify finds matching POIs and available public contact fields from OpenStreetMap. A restricted `GOOGLE_PLACES_API_KEY` is optional and is called only as a fallback when the primary providers do not return enough contactable results. The command prints at most 20 deduplicated results directly in Telegram without a campaign or persistence. `/sales_find <campaign-id> | <service> | <location> | <limit>` runs the same discovery and imports only candidates that publish a website. It can also ingest companies from a configured public JSON feed or `POST /v1/leads`. `/sales_run` crawls candidate websites, records an auditable snapshot, extracts public e-mail addresses and explicit `tel:` evidence, reuses an ARES IČO established during discovery or attempts an exact-name ARES verification, deterministically detects company country and primary website language, selects the outreach language, scores the lead, and prepares a draft. When `OLLAMA_URL` and `OLLAMA_MODEL` are set, the draft uses the shared structured Ollama provider, the versioned cold-email prompt, Zod output validation, and deterministic grounding/style checks with one constrained retry. The draft is never sent by this step. Sales and OSINT share the same ARES source client; they do not call each other's Telegram bot. Unknown contact authorization does not stop research. Firmy.cz is not scraped.

Enrollment in Quickly is a separate, fail-closed step. It requires a qualified lead, an operator approval, a syntactically valid email, a recorded `RECIPIENT_OPT_IN` or `EXISTING_CUSTOMER` authorization with nonempty evidence source/reference and valid dates, no suppression, an enabled campaign with a Quickly campaign ID, and available daily capacity. A public email address or Telegram approval alone is **not** authorization. No evidence is seeded or inferred from scraping. Quickly enrollment immediately schedules messages according to its own campaign settings; configure that campaign and its sequence, sending hours, unsubscribe handling, and reply-stop behavior before enabling it. The generated draft is passed in `custom_data`, but you must configure Quickly's sequence to use those fields or review its own campaign copy; the integration cannot guarantee an independently configured Quickly sequence uses the draft.

The standard Compose stack includes the sales bot, Quickly v2.4.0 with its own PostgreSQL 15 database, and Twenty v2.43.0 with its own PostgreSQL 16 database, Redis, server, and worker. `QUICKLY_BASE_URL=http://quickly:8000` and `TWENTY_BASE_URL=http://twenty-server:3000` are container-to-container URLs; the browser-facing URLs are separate `BASE_URL` and `SERVER_URL` values. The release waits for Quickly and Twenty health checks. Their API clients in the sales bot remain inactive until API keys are supplied after initial setup. Apply the versioned [Watcher Sales CRM Twenty App](apps/twenty-sales-app/README.md) before enabling `TWENTY_APP_FIELDS_ENABLED=true`. Company and Person upserts are idempotent; generated drafts are stored as native Twenty Notes with prompt/model/language metadata. Opportunities are exposed through the integration layer but are not guessed or created automatically.

Set `SALES_TELEGRAM_TOKEN`, `SALES_API_TOKEN` (32+ random characters), `SALES_WEBHOOK_TOKEN` (a different 32+ character secret), and `TELEGRAM_ALLOWED_USER_IDS`. Create strong, unique URL-safe PostgreSQL passwords for Quickly and Twenty; copy each password into its `POSTGRES_PASSWORD` and database URL in the matching preset, then set `QUICKLY_SECRET_KEY` and `ENCRYPTION_KEY`. The presets have no working secrets. For development, copy both integration presets to a private location, point `QUICKLY_ENV_FILE` and `TWENTY_ENV_FILE` at those copies, and run `docker compose up -d`. For production, populate `sales-bot.env`, `quickly.env`, and `twenty.env` in `deploy/runtime` with mode `0600` before the next release. The deploy script validates their required values, backs up their PostgreSQL databases, starts the full stack, and waits for health checks. The production renderer can generate the env files from `QUICKLY_POSTGRES_PASSWORD`, `QUICKLY_SECRET_KEY`, `TWENTY_POSTGRES_PASSWORD`, `TWENTY_ENCRYPTION_KEY`, and the other sales variables; it regenerates the entire runtime directory, so preserve its secret source before rerunning it.

Quickly and Twenty bind only to VPS loopback (`127.0.0.1:8000` and `127.0.0.1:3002` by default); the sales API similarly binds `127.0.0.1:4050`. Set `QUICKLY_HOST_PORT` or `TWENTY_HOST_PORT` in `deploy/runtime/compose.env` when the default host port is unavailable. To expose either UI only inside a private VPN, set `QUICKLY_BIND_ADDRESS` or `TWENTY_BIND_ADDRESS` to the VPS address on that VPN; do not use `0.0.0.0` unless the host firewall independently blocks public access. Keep Quickly's `BASE_URL` and `CORS_ORIGINS`, and Twenty's `SERVER_URL`, aligned with the address and port clients use. The production renderer derives those Quickly values from `QUICKLY_BIND_ADDRESS` and `QUICKLY_HOST_PORT` unless `QUICKLY_PUBLIC_URL` or `QUICKLY_CORS_ORIGINS` is supplied explicitly. Production `sales-bot` also joins the existing external `lateralis` Docker network while retaining its loopback host binding. Its main database URL uses the unique `watcher-postgres` alias so a different `postgres` service on that shared network cannot capture the connection. A token-managed Cloudflare Tunnel container on that network can therefore use `http://sales-bot:4050` as a public-hostname origin; configure the hostname in Cloudflare Zero Trust and protect it with Cloudflare Access where appropriate. The service is a REST API, not a web UI. Every `/v1/*` request still requires either `Authorization: Bearer $SALES_API_TOKEN` or, for `/v1/webhooks/quickly`, `Authorization: Bearer $SALES_WEBHOOK_TOKEN`; only `/healthz` is unauthenticated. After first login, create API keys in Quickly and Twenty and put them in `sales-bot.env` as `QUICKLY_API_KEY` and `TWENTY_API_KEY`; create a Quickly campaign and set its campaign ID through the sales API. Configure Quickly's webhook to `http://sales-bot:4050/v1/webhooks/quickly` with the same bearer secret as `SALES_WEBHOOK_TOKEN`, subscribing at least to `email.sent`, `email.bounced`, `lead.replied`, `lead.not_interested`, and `lead.unsubscribed`. The evening call report requires `email.sent`: merely enrolling a lead is not proof of delivery. No API key, campaign, or authorization evidence is preseeded. The release creates pre-deployment dumps of the Quickly and Twenty PostgreSQL databases; back up Twenty's local-data volume separately.

At `SALES_FOLLOWUP_TIME=20:00` in `SALES_TIMEZONE=Europe/Prague` (both configurable), each authorized Telegram user receives a cold-call list for the following day based on observed Quickly `email.sent` webhooks. Monday–Thursday reports contain that local day's sends. No report is sent on Friday or Saturday; Sunday's report combines Friday–Sunday sends for Monday calls. Contacts are deduplicated by email, with company, email, public `tel:` number when found, contact page/web, campaign, current reply/suppression status, and `/sales_lead` detail. Negative/replied states are explicitly flagged for review before calling. An empty report says no sends were _recorded_, not that Quickly definitely sent none. Quickly's webhooks are fire-and-forget, so a missing webhook can make the list incomplete; check Quickly's sent-email history when counts differ. Reports are delivered through the persistent Telegram outbox and are not resent after the local report date. Changing the configured send time after a report has queued does not create a duplicate for that date.

The API uses `Authorization: Bearer $SALES_API_TOKEN`, except `POST /v1/webhooks/quickly`, which uses `SALES_WEBHOOK_TOKEN`. Main routes are `POST/GET /v1/campaigns`, `PATCH /v1/campaigns/{id}`, `POST/GET /v1/leads`, `GET /v1/leads/{id}` (includes eligibility reasons), `POST /v1/leads/{id}/approve`, `POST /v1/leads/{id}/reject`, `POST /v1/evidence`, `GET/DELETE /v1/campaigns/{id}/evidence/{email}`, `GET /v1/campaigns/{id}/evidence/{email}/events`, `POST /v1/suppressions`, and `POST /v1/run`. A discovery feed is a JSON array of `{ "id", "name", "websiteUrl", "sourceUrl"?, "entityType"?, "address"?, "countryCode"?, "languageCode"?, "phone"? }`. Campaigns start disabled; `enabled` controls only Quickly sending, not research. After creating a campaign, copy its UUID into `/sales_find UUID | autoservis | Brno | 15`, run `/sales_run`, then use `/sales_calls 20` for scored leads with a website-sourced public phone. Scoring has four auditable components: explicit discovery fit (up to 25), website need (30), contactability (20), and evidence confidence (15); the default qualification threshold remains 70. A score or public phone is not legal permission to call. `POST /v1/evidence` requires `campaignId`, `email`, `basis`, `evidenceSource`, `evidenceReference`, and an ISO `capturedAt`; an optional `expiresAt` is supported. Evidence is scoped to one campaign. Supply a real, retrievable evidence reference from your own lawful collection process. The API records your assertion and metadata; it cannot independently prove that the referenced artifact is valid or that an existing-customer exception applies. Revocation and suppressions block future enrollment; renewing a revoked authorization requires newer evidence, and prior evidence remains in an append-only event history.

Telegram commands: `/help` or `/sales_help` for the detailed workflow and compliance guide; `/about` or `/sales_about` for purpose, integrations, states, limits, and safety boundaries; `/sales_status`; `/sales_campaigns`; `/sales_search <service> | <location> | <limit>`; `/sales_find <campaign-id> | <service> | <location> | <limit>`; `/sales_calls [limit]`; `/sales_leads`; `/sales_lead <id>`; `/sales_approve <id>`; `/sales_reject <id>`; and `/sales_run`. Approval is deliberately distinct from authorization evidence. When a lead lacks evidence, `/sales_lead` shows `legal_basis_not_evidenced`; analysis and draft remain available. The bot registers its command menu with Telegram at startup.

Current MVP limitations: ARES registered seats are not necessarily operating locations, and its address filter works best with a municipality rather than a whole region; Geoapify handles region boundaries but OpenStreetMap contact coverage is incomplete. Google Places is only an optional fallback rather than a general search-provider crawl. Natural-language category mapping is intentionally bounded; `horské chaty` maps to Geoapify huts/chalets and CZ-NACE 55200, while `nace:<code>` or `geo:<category>` selects an exact unsupported sector. Each search logs the resolved categories, per-source status/duration/counts, fallback decision, and final provider/contact totals without logging API keys. Scoring remains deterministic; email validation is syntax-only (not mailbox verification); a Person is created only when discovery supplies an identified human contact, and the current website discovery normally has only a company-level mailbox; Opportunities, referral payment transitions, and Twenty Workflows are not created automatically; and Quickly webhook handling does not yet cancel a previously queued message if authorization is revoked after enrollment. Keep campaigns disabled until those operational conditions are acceptable.

Watcher is a production-oriented, self-hosted, Telegram-only monitoring system for one operator. It runs independent TypeScript bot processes on one Linux server:

- **Stocks Watcher** monitors SEC filings, auto-discovered issuer feeds, Federal Register notices, official FTC/DOJ announcements, TradingView symbol news, curated first-party company intelligence for selected AI-infrastructure stocks, FINVIZ insider transactions, Zacks rank/quote snapshots, Earnings Whispers earnings snapshots, and price snapshots.
- **Publications Watcher** monitors PubMed, bioRxiv, ClinicalTrials.gov, and openFDA results.
- **News Watcher** runs Czech and Global editorial profiles through one shared RSS/Atom ingestion, deduplication, and ranking engine.
- **Reality Investment Analyst** produces a monthly Czech housing-market report and continuously evaluates sale and rental listings collected from a permitted public RSS source for yield, financing stress, discount, and cashflow opportunities.
- **MU Clubs Monitor** checks verified public websites, Linktrees, and Instagram profiles for meaningful Brno/MUNI club activities and publishes qualifying current items to the briefing event stream.
- **Personal Morning Briefing** consumes meaningful normalized events from the watcher producers, combines them with optional weather and read-only Google Calendar context, and delivers a scheduled or manual spoken briefing through Telegram.
- **Maintenance Agent** evaluates every service from normalized run, source, cost, latency, and downstream-feedback telemetry and produces human-reviewed recommendations without changing production.

Watcher services share PostgreSQL and an external Ollama instance. The sales stack adds the Twenty and Quickly web UIs, their private databases, and Twenty's Redis; Watcher itself still has no web UI, host cron, or bundled Ollama service. See [the Morning Briefing architecture and operations](docs/morning-briefing-architecture.md).

## How it works

Each source normalizes provider data into a common `WatchItem`; the persistence boundary records a richer normalized observation with source provenance and separate publication, discovery, and event timestamps. A run waits for all enabled targets and sources with `Promise.allSettled`, records individual source failures, reserves new items through PostgreSQL uniqueness constraints, analyzes only reserved items with Ollama, and persists the run result. Company and observation changes also produce append-only domain journal events. Already processed SEC filings, RSS/news entries, price snapshots, PubMed articles, bioRxiv papers, clinical trials, and FDA reports are skipped by stable source identity. Manual and scheduled runs use this exact same path.

Schedule state and overlap locks are stored in PostgreSQL. A stale lock is recoverable after two hours. Stock collectors remain scheduled producers, while market discovery and future internal producers can submit ticker-scoped candidates through the in-process event bus for immediate processing. Articles remain evidence under canonical stock events; event analysis and Telegram delivery are separate. Scheduled runs do not send article-by-article digests. Material alerts accumulate for 60 minutes by default and are sent as one batch, overnight alerts wait for the morning notification window, and only configured EXTREME alerts may bypass batching. A manual `/run` still edits its progress message and returns its diagnostic digest.

## Requirements

- Node.js 24
- pnpm 11.6.0
- Docker Engine with Docker Compose v2 for the recommended local and production paths
- Private Telegram bots created with BotFather for every Telegram-facing service, including Maintenance
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

   Also create private copies of `deploy/presets/quickly.env.example` and
   `deploy/presets/twenty.env.example`, populate their database passwords and
   app secrets, and set `QUICKLY_ENV_FILE` and `TWENTY_ENV_FILE` in `.env` to
   those paths. OSINT and sales bot tokens are required in `.env` as well.

3. Make sure Ollama accepts connections from Docker. On Linux and Docker Desktop, the default URL is `http://host.docker.internal:11434`. Pull the configured generation and embedding models first, for example `ollama pull qwen3.5:4b` and `ollama pull nomic-embed-text`.

4. Download the accepted Piper voice models, then build, migrate, and start all bots:

   ```bash
   PIPER_ACCEPT_VOICE_LICENSES=true ./deploy/download-piper-voices.sh
   WATCHER_ENV_FILE=.env docker compose up -d --build
   WATCHER_ENV_FILE=.env docker compose ps
   WATCHER_ENV_FILE=.env docker compose logs -f stocks-bot publications-bot news-bot reality-bot mu-clubs-monitor brno-events-agent briefing-bot maintenance-agent osint-bot sales-bot quickly twenty-server twenty-worker
   ```

   The installer includes `cs_CZ-jirka-medium`. The Briefing Bot keeps the
   selected English voice for the main briefing and automatically switches to
   Jirka for Calendar event sentences detected as Czech, then joins every
   segment into one Opus voice message.

PostgreSQL uses the pinned `pgvector/pgvector:0.8.6-pg16-bookworm` image and is published only on host loopback as `127.0.0.1:5433`; it is not directly reachable from the public internet. Its data lives in the `watcher-postgres` named volume. The migration creates the `vector` extension once and deployment verifies it before starting applications. Briefing events from News and every other producer, plus stock events in the immediate intelligence pipeline, reuse the same configured Ollama embedding provider and PostgreSQL extension. Embeddings are cached and used only after bounded candidate narrowing and deterministic compatibility checks; similarity alone never merges events. No News-specific vector table, fixed embedding dimension, or second vector database is introduced. The one-shot `migrate` service must complete before applications start. For remote administration, use the SSH/Tailscale tunnel documented in `deploy/README.md`.

The bots emit structured JSON logs. At `LOG_LEVEL=info`, watcher runs record start, prepared source count, per-source fetch outcomes, source failures, notification sends, and completion counters. The briefing bot records commands, freshness-gate waits, semantic-clustering counts, context availability and latency, story-selection metrics, script and audio generation, Telegram delivery channels, and the final run duration. Each service exposes an internal `/healthz` readiness endpoint used by Compose; it verifies application startup and PostgreSQL, the Ollama-backed bots also verify Ollama, and Briefing additionally checks every Piper model file. The Maintenance `/status` command probes those private endpoints and combines readiness with latest-run freshness and recent errors. Capacity alerts use read-only host `/proc` and `/sys` views to report accurate RAM and the largest relevant processes; process environments are never read. Set `LOG_LEVEL=debug` to also log individual watcher item analysis, cached-analysis reuse, idle briefing scheduler checks, non-command Telegram updates, Piper chunks, and delivery attempts.

## Study bot

`study-bot` is a private Telegram study assistant for text-based university PDFs. Send it a PDF and it acknowledges receipt immediately, then persists the file under `documents/study-bot/` in RustFS, extracts text page-by-page, creates source-grounded chunk facts through the existing globally serialized Ollama queue, writes a spoken lecture, synthesizes OGG/Opus audio with the installed Piper voice, stores it under `media/study-bot/`, and returns it as a Telegram voice message. The database stores only metadata, page text, page references, jobs, scripts, and object keys.

It never sends a scanned/near-empty PDF to the language model: it reports that OCR is required. Every analysis prompt treats the source as authoritative, records page ranges internally, and rejects malformed structured output. `/status` shows the latest job, `/cancel` safely stops it between stages, and the completion buttons resend the audio, create a short text summary, start a five-question source-cited quiz, or generate a stored UTF-8 TSV flashcard deck for direct Anki import. Each Anki card has source-page tags and a source citation on its back.

To enable Study Bot, set `STUDY_TELEGRAM_TOKEN`, `STUDY_S3_ACCESS_KEY_ID`, and `STUDY_S3_SECRET_ACCESS_KEY` in addition to the shared database, Telegram-authorization, Ollama, and Piper settings in `.env.example`. The RustFS credentials must be application-specific and limited to `documents/study-bot/*` and `media/study-bot/*`. In production, `study-bot` joins the server's existing external `lateralis` Docker network so `http://rustfs:9000` resolves; local Compose may instead use an explicitly reachable S3-compatible endpoint. An unconfigured Study Bot is skipped and never blocks deployment of the other agents.

Example interaction:

```text
You: [upload genetics-notes.pdf]
Study bot: 📚 PDF received. Analyzing the material...
Study bot: 📖 Extracting text...
Study bot: 🧠 Creating study outline...
Study bot: ✍️ Preparing lecture...
Study bot: 🎙️ Generating audio...
Study bot: 🎧 Your lecture is ready.
```

Before a scheduled delivery, the Briefing Bot requests one immediate run from every stale subscribed producer and waits up to the configured freshness timeout. If a producer still has not finished, the briefing continues with available data and marks that source as stale or unavailable rather than blocking delivery and the follow-up goals message indefinitely. It then ranks cross-source stories, calls out Calendar deadlines, overlaps, short gaps, and likely travel transitions, and ends with a short action agenda. Personal ranking is managed with `/priority_add TOPIC`, `/priority_remove TOPIC`, `/mute_add TOPIC`, and `/mute_remove TOPIC`; urgent stories are never hidden solely by a mute. Every delivered voice briefing has useful, less-useful, and too-long feedback buttons. A too-long rating idempotently reduces future target and maximum duration by one minute.

With the Stocks subscription enabled, every briefing includes known exact earnings dates for enabled watchlist stocks from today through the next 14 local calendar days, even if no new stories were found. Only high-materiality, highly relevant stock events enter the news section. If targeted analysis fails, a sourced headline may appear without an investment conclusion. An unavailable earnings lookup is reported as unavailable, not as an empty calendar. The older one-week and one-day reminders remain stored but do not repeat as separate briefing stories.

The Briefing Bot also stores private, per-chat goals in PostgreSQL; manage them in a private Telegram chat. Add one with `/goal_add YYYY-MM-DD Goal title` (for example `/goal_add 2027-06-30 Finish my degree`), review the complete list with `/goals`, and remove it by its displayed numeric ID with `/goal_remove ID`. After each morning or evening scheduled or manual briefing, it sends a separate final message with the 10 nearest upcoming deadlines and their remaining calendar days in the chat's configured timezone; overdue goals follow upcoming ones. Test and afternoon/night briefings do not send this extra message. If no goals are saved, the message explains how to add one. Goal delivery is tracked independently: a Telegram failure marks the run partial, and `/goals` can be used to retrieve the list manually.

On Monday mornings, a connected Google Calendar is also checked for personal birthdays and name days in the two following full calendar weeks. The briefing deterministically announces and lists matching events once in the one-week-ahead window and once in the two-week-ahead window. Public and bank holidays are excluded, duplicate calendar entries are collapsed, and an unavailable Calendar is reported instead of being treated as an empty result. This reminder follows `/briefing_time`; it has no separate scheduler or command.

On the last calendar day of each month in the configured timezone, the morning briefing adds a deterministic reminder to pay OSVČ advances and review soft skills, finances, and progress on every goal. The reminder appears in both the spoken briefing and the compact Telegram index even when transcript delivery is disabled; it is not repeated in the evening briefing. It is a personal checklist, not a claim about statutory payment due dates.

To stop the application without deleting data:

```bash
docker compose down
```

## Reality Investment Analyst

`apps/reality-bot` is a private Telegram service with two cadences. On the first day of each month it sends one compact market screen followed by financing, macro, city price/rent/yield, development, demographic, regulatory, mortgage-stress, and TOP-10 opportunity sections. Every 30 minutes by default it refreshes listings and immediately alerts only when a listing meets all three persisted gates: gross yield at least 6%, price per square metre at least 15% below the supplied local median, and positive cashflow at a 5% mortgage rate.

The default investment model is a CZK 3 million, 60 m² purchase, 30% equity, 70% mortgage, 30 years, 5% vacancy, annual maintenance equal to 1% of purchase price, and CZK 3,000 annual insurance. `/model` shows or changes the primary assumptions. The calculator derives annuity payments, gross and net yield, current cashflow, and stress cashflows at 3%, the current supplied mortgage rate, 5%, 6%, and 7%. Listing price history is persisted, so discounts and time on market are observations rather than guessed values.

Commands are `/start`, `/help`, `/about`, `/status`, `/run`, `/pause`, `/resume`, `/schedule`, `/locations`, `/location_add`, `/location_remove`, and `/model`. All commands and callbacks use the common Telegram allowlist. Schedule state and overlap locks survive restarts; source failures are isolated and shown in the report.

The bot collects sale and rental flats itself from DigiReality's public RSS channel for every watched city. It derives current asking-price and rent medians from the newest RSS sample, estimates rent for sale listings, and persists price history for deal monitoring. Anonymous personal use works within DigiReality's published limits; `REALITY_DIGIREALITY_KEY` is optional. The adapter caches each city for 55 minutes, does not download photographs, does not bypass portal protections, and drops offers without a numeric price or usable floor area instead of inventing values. See [the source and calculation policy](docs/reality-bot.md).

## Transport Opportunity Bot

`apps/transport-bot` is a private Telegram decision engine for a single van operator. It normalizes a configured JSON request feed, rejects loads that cannot be proven to fit, routes viable candidates over an OSRM-compatible road service, and shows only jobs that pass the operator's profit, profit/hour, empty-distance, detour, and confidence thresholds. The same evaluator is used by manual searches and scheduled proactive discovery.

The bot provides mobile buttons for finding jobs, planning a trip, finding a geographically useful return load, editing the vehicle, preferences, and detailed cost rates. Planned-trip recommendations charge only additional distance and time beyond the baseline journey. Notifications expose fuel, wear, maintenance, tyres, oil, insurance, driver, toll, and other costs; depreciation/wear remains an estimate rather than an accounting assertion. Unknown cargo size or weight is never treated as compatible.

Fuel defaults to the official European Commission Weekly Oil Bulletin diesel price converted to CZK with the Czech National Bank daily rate. The last successful value is persisted and explicitly marked stale when refresh fails; a Telegram cost edit can override it. Geocoding and routes are cached in PostgreSQL. For production, set `TRANSPORT_OSRM_URL` to an OSRM-compatible service with an appropriate SLA—the public project server is only the development default.

The first request provider is a replaceable normalized JSON feed. `TRANSPORT_REQUEST_FEED_URL` must return either an array or `{ "requests": [...] }`. Each item uses `externalId`, `source`, optional `sourceUrl`, optional `pickup` and `delivery` (`address`, `latitude`, `longitude`), optional pickup/delivery windows (`from`, `to`), `cargo.description` plus any known weight/dimensions/volume/pallet count, optional `offeredPrice`, a three-letter `currency`, `publishedAt`, optional `expiresAt`, and `raw`. Missing fields must be omitted, never fabricated. An optional bearer token is read from `TRANSPORT_REQUEST_FEED_TOKEN`.

The MVP deliberately does not bid, accept jobs, or contact customers. It retains normalized and original observations, disappearance/expiry state, opportunities, rejection reasons, planned trips, and cost/routing inputs for later historical analysis.

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
pnpm --filter @watcher/reality-bot dev
pnpm --filter @watcher/mu-clubs-monitor dev
pnpm --filter @watcher/brno-events-agent dev
pnpm --filter @watcher/maintenance-agent dev
pnpm --filter @watcher/transport-bot dev
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

| Name                                                    | Used by               | Meaning                                                                                                  |
| ------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------- |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`     | PostgreSQL            | Local Compose database initialization                                                                    |
| `DATABASE_URL`                                          | migrations, all bots  | PostgreSQL connection URL                                                                                |
| `STOCKS_TELEGRAM_TOKEN`                                 | stocks bot            | BotFather token for the stocks bot                                                                       |
| `TRANSPORT_TELEGRAM_TOKEN`                              | transport bot         | BotFather token for the private transport-opportunity bot                                                |
| `TRANSPORT_REQUEST_FEED_URL`                            | transport bot         | HTTPS endpoint returning normalized transport requests                                                   |
| `TRANSPORT_REQUEST_FEED_TOKEN`                          | transport bot         | Optional bearer token for the configured request feed                                                    |
| `TRANSPORT_OSRM_URL`                                    | transport bot         | OSRM-compatible road-routing base URL; use a production service outside development                      |
| `TRANSPORT_DISCOVERY_INTERVAL_MINUTES`                  | transport bot         | Scheduled opportunity discovery cadence; defaults to 15 minutes                                          |
| `TRANSPORT_FUEL_BULLETIN_URL`, `TRANSPORT_CNB_RATE_URL` | transport bot         | Optional overrides for the official fuel workbook and CZK exchange-rate endpoints                        |
| `TRANSPORT_HEALTH_PORT`                                 | transport bot         | Readiness listener; defaults to 4040                                                                     |
| `PUBLICATIONS_TELEGRAM_TOKEN`                           | publications bot      | BotFather token for the publications bot                                                                 |
| `NEWS_TELEGRAM_TOKEN`                                   | news bot              | Distinct BotFather token for the Czech and Global news profiles                                          |
| `REALITY_TELEGRAM_TOKEN`                                | reality bot           | Distinct BotFather token for the private Reality Investment Analyst                                      |
| `REALITY_DIGIREALITY_KEY`                               | reality bot           | Optional DigiReality RSS key; anonymous personal use remains supported within the public quota           |
| `REALITY_REPORT_SCHEDULE`                               | reality bot           | Persistent default monthly schedule, `0 8 1 * *`                                                         |
| `REALITY_MONITOR_INTERVAL_MINUTES`                      | reality bot           | Immediate-deal refresh cadence, default 30 minutes                                                       |
| `BRIEFING_TELEGRAM_TOKEN`                               | briefing bot          | Distinct BotFather token for the personal morning briefing bot                                           |
| `MAINTENANCE_TELEGRAM_TOKEN`                            | maintenance agent     | BotFather token used for private reports and one-time project update announcements                       |
| `MAINTENANCE_API_TOKEN`                                 | maintenance agent     | Bearer token protecting every `/maintenance/*` endpoint                                                  |
| `MAINTENANCE_ENABLED`                                   | maintenance agent     | Enables periodic evaluation; manual API and Telegram runs remain available                               |
| `MAINTENANCE_HOST`, `MAINTENANCE_PORT`                  | maintenance agent     | Internal HTTP listener; Compose publishes port 4030 to host loopback only                                |
| `MAINTENANCE_HEALTH_INTERVAL_MINUTES`                   | maintenance agent     | Lightweight health cadence; defaults to 360 minutes                                                      |
| `MAINTENANCE_ANALYSIS_INTERVAL_MINUTES`                 | maintenance agent     | Deep daily analysis cadence; defaults to 1440 minutes                                                    |
| `MAINTENANCE_WEEKLY_ANALYSIS_ENABLED`                   | maintenance agent     | Enables the 30-day trend evaluation                                                                      |
| `MAINTENANCE_WEEKLY_INTERVAL_MINUTES`                   | maintenance agent     | Weekly trend cadence; defaults to 10080 minutes                                                          |
| `MAINTENANCE_JITTER_MAX_SECONDS`                        | maintenance agent     | Maximum startup jitter to avoid a load spike; defaults to 300 seconds                                    |
| `MAINTENANCE_AGENT_STATUS_STALE_MINUTES`                | maintenance agent     | Stale-run threshold for `/status`; defaults to 1560 minutes                                              |
| `MAINTENANCE_AGENT_STATUS_ERROR_LOOKBACK_MINUTES`       | maintenance agent     | Recent-error lookback for `/status`; defaults to 1440 minutes                                            |
| `MAINTENANCE_SELF_REVIEW_ENABLED`                       | maintenance agent     | Includes basic self telemetry when enabled; defaults to false                                            |
| `MAINTENANCE_CHANGELOG_PATH`                            | maintenance agent     | Runtime path to the append-only project update Markdown file                                             |
| `MAINTENANCE_RELEASE_PATH`                              | maintenance agent     | Read-only path to the successfully promoted release announcement; defaults to `/app/release/current.txt` |
| `MAINTENANCE_RESOURCE_MONITOR_ENABLED`                  | maintenance agent     | Enables server capacity warnings and debug run delivery; defaults to true                                |
| `MAINTENANCE_RESOURCE_MONITOR_INTERVAL_MS`              | maintenance agent     | CPU/RAM/GPU sample and completed-run polling cadence; defaults to 30000 ms                               |
| `MAINTENANCE_CPU_WARNING_PERCENT`                       | maintenance agent     | Sustained server CPU warning threshold; defaults to 90                                                   |
| `MAINTENANCE_MEMORY_WARNING_PERCENT`                    | maintenance agent     | Sustained server/container memory warning threshold; defaults to 90                                      |
| `MAINTENANCE_GPU_WARNING_PERCENT`                       | maintenance agent     | Sustained GPU utilization or VRAM warning threshold; defaults to 90                                      |
| `MAINTENANCE_CAPACITY_SUSTAINED_SAMPLES`                | maintenance agent     | Consecutive over-threshold samples required before warning; defaults to 3                                |
| `MAINTENANCE_CAPACITY_ALERT_COOLDOWN_MINUTES`           | maintenance agent     | Minimum interval between repeated warnings; defaults to 30 minutes                                       |
| `MAINTENANCE_NVIDIA_SMI_PATH`                           | maintenance agent     | NVIDIA telemetry executable; GPU remains unavailable when no NVIDIA/AMD interface is exposed             |
| `MU_CLUBS_API_TOKEN`                                    | MU Clubs, briefing    | Bearer token protecting its API and allowing Briefing Bot to invoke a manual run                         |
| `BRNO_EVENTS_API_TOKEN`                                 | Brno Events, briefing | Bearer token protecting its API and allowing Briefing Bot to invoke all or one source                    |
| `BRIEFING_BRNO_EVENTS_URL`                              | briefing bot          | Internal Brno Events API URL; defaults to `http://brno-events-agent:4020`                                |
| `BRIEFING_MU_CLUBS_URL`                                 | briefing bot          | Internal MU Clubs API URL; defaults to `http://mu-clubs-monitor:4010`                                    |
| `BRIEFING_AGENT_TRIGGER_TIMEOUT_MS`                     | briefing bot          | Timeout for synchronous producer triggers; defaults to `180000` milliseconds                             |
| `MU_CLUBS_HOST`, `MU_CLUBS_PORT`                        | MU Clubs monitor      | Internal HTTP listener; Compose publishes port 4010 to host loopback only                                |
| `MU_CLUBS_MONITOR_INTERVAL_MINUTES`                     | MU Clubs monitor      | Scheduled monitor cadence                                                                                |
| `INSTAGRAM_CACHE_TTL_MINUTES`                           | shared Instagram      | Reuse window for public profile and post results                                                         |
| `INSTAGRAM_MIN_REQUEST_INTERVAL_MS`                     | shared Instagram      | Minimum delay between public Instagram requests                                                          |
| `INSTAGRAM_MAX_POSTS_PER_FETCH`                         | shared Instagram      | Hard cap on posts requested per profile                                                                  |
| `TELEGRAM_ALLOWED_USER_IDS`                             | all bots              | Comma-separated Telegram numeric user IDs; every command and callback is denied unless listed            |
| `OLLAMA_URL`                                            | all bots              | Ollama base URL                                                                                          |
| `OLLAMA_MODEL`                                          | all bots              | Installed Ollama model name                                                                              |
| `OLLAMA_KEEP_ALIVE`                                     | all bots              | How long Ollama keeps the model loaded; defaults to `5m`                                                 |
| `OLLAMA_MAX_ITEMS_PER_RUN`                              | watcher producers     | Maximum new items analyzed in one run; Publications additionally enforces a hard cap of 15               |
| `OLLAMA_NUM_CTX`                                        | watcher producers     | Per-request context size; defaults to `4096`                                                             |
| `BRIEFING_OLLAMA_NUM_CTX`                               | briefing bot          | Briefing script context size; defaults to `8192` without increasing producer requests                    |
| `BRIEFING_EMBEDDING_MODEL`                              | stocks, briefing      | Shared Ollama model for bounded stock-event and briefing-story similarity; empty disables it             |
| `BRIEFING_EMBEDDING_MIN_SIMILARITY`                     | stocks, briefing      | Shared minimum cosine similarity for a semantic candidate; defaults to `0.82`                            |
| `BRIEFING_EMBEDDING_WINDOW_HOURS`                       | stocks, briefing      | Shared maximum time distance between semantic candidates; defaults to `96` hours                         |
| `BRIEFING_SCHEDULER_MAX_DELAY_MINUTES`                  | briefing bot          | Late-delivery grace window; older missed briefings are skipped; defaults to `10` minutes                 |
| `BRIEFING_FRESHNESS_MAX_AGE_MINUTES`                    | briefing bot          | Maximum accepted age of a producer run before scheduled delivery; defaults to `1560` minutes             |
| `BRIEFING_FRESHNESS_WAIT_TIMEOUT_MINUTES`               | briefing bot          | Maximum producer wait before delivery continues with available data; defaults to `20` minutes            |
| `BRIEFING_FRESHNESS_POLL_INTERVAL_MS`                   | briefing bot          | Poll interval while waiting for producer freshness; defaults to `30000` milliseconds                     |
| `OLLAMA_NUM_PREDICT`                                    | watcher producers     | Maximum generated tokens per analysis; defaults to `768`                                                 |
| `OLLAMA_FULL_ANALYSIS_NUM_PREDICT`                      | stocks bot            | Output-token cap for the larger thesis/scenario response; defaults to `1536`                             |
| `OLLAMA_RETRIES`                                        | watcher producers     | Retry count after a failed or invalid response; defaults to `1`                                          |
| `OLLAMA_THINK`                                          | watcher producers     | Enables model thinking output; defaults to `false` to avoid unnecessary compute                          |
| `OLLAMA_TIMEOUT_MS`                                     | watcher producers     | Per-attempt timeout, from 10–180 seconds; defaults to 120 seconds                                        |
| `SEC_USER_AGENT`                                        | stocks bot            | SEC-compliant app name and contact address                                                               |
| `DEFAULT_TIMEZONE`                                      | all bots              | IANA timezone used for a newly created watcher or briefing setting                                       |
| `LOG_LEVEL`                                             | all bots              | Pino log level, normally `info`                                                                          |
| `STOCK_EVENT_COOLDOWN_MINUTES`                          | stocks bot            | Same-event analysis cooldown; defaults to 360 minutes                                                    |
| `STOCK_TICKER_ANALYSIS_COOLDOWN_MINUTES`                | stocks bot            | Same-ticker analysis cooldown; defaults to 30 minutes                                                    |
| `SOURCE_BACKOFF_BASE_SECONDS`                           | watcher producers     | Initial source-failure backoff; defaults to 60 seconds                                                   |
| `SOURCE_BACKOFF_MAX_MINUTES`                            | watcher producers     | Maximum exponential source backoff; defaults to 360 minutes                                              |
| `SOURCE_MAX_CONCURRENCY`                                | watcher producers     | Global ceiling for concurrent external source requests per watcher; defaults to 8                        |
| `ALERT_ATTENTION_THRESHOLD`                             | stocks bot            | Attention score that creates a live alert when crossed; defaults to 85                                   |
| `STOCK_ALERT_BATCH_WINDOW_MINUTES`                      | stocks bot            | Accumulation delay for non-extreme alert batches; defaults to 60 minutes                                 |
| `STOCK_NOTIFICATION_START_HOUR`                         | stocks bot            | First local hour when queued stock alerts may be delivered; defaults to 7                                |
| `STOCK_NOTIFICATION_END_HOUR`                           | stocks bot            | Local hour at which stock alerts begin waiting for morning; defaults to 22                               |
| `STOCK_EXTREME_IMMEDIATE`                               | stocks bot            | Allows rare EXTREME alerts to bypass the batch window; defaults to true                                  |
| `RECONCILIATION_INTERVAL_MINUTES`                       | stocks bot            | Interval for comprehensive recovery scans; defaults to one day                                           |
| `VALIDATION_MIN_SAMPLE_SIZE`                            | stocks bot            | Completed 30-day samples required to mark signal statistics adequate; defaults to 20                     |
| `ALPHA_VANTAGE_API_KEY`                                 | stocks bot            | Optional Alpha Vantage key for discovery and institutional holdings                                      |
| `ALPHA_VANTAGE_OPTIONS_ENABLED`                         | stocks bot            | Enables premium realtime option-chain requests; defaults to `false`                                      |
| `QUIVER_API_TOKEN`                                      | stocks bot            | Optional Quiver bearer token; leaving it empty disables Quiver requests                                  |
| `ALPACA_PAPER_API_KEY`, `ALPACA_PAPER_API_SECRET`       | stocks bot            | Optional paired **Paper-only** API credentials for the read-only `/alpaca` command                       |
| `TRADING212_API_KEY`, `TRADING212_API_SECRET`           | stocks bot            | Optional paired read-only Trading 212 Invest/Stocks ISA credentials; never put them in Telegram or Git   |
| `TRADING212_ENVIRONMENT`                                | stocks bot            | `LIVE` or `DEMO` Trading 212 API endpoint; defaults to `LIVE`                                            |
| `TRADING212_TELEGRAM_USER_ID`                           | stocks bot            | Required with Trading 212 credentials; only this authorized user can see the account in a private chat   |
| `PRICE_ANOMALY_THRESHOLD_PERCENT`                       | stocks bot            | Absolute daily-return anomaly threshold; defaults to 4%                                                  |
| `GAP_ANOMALY_THRESHOLD_PERCENT`                         | stocks bot            | Absolute opening-gap anomaly threshold; defaults to 3%                                                   |
| `RELATIVE_VOLUME_ANOMALY_THRESHOLD`                     | stocks bot            | Relative-volume anomaly multiplier; defaults to 3                                                        |
| `VOLATILITY_EXPANSION_THRESHOLD`                        | stocks bot            | Current-move versus historical-volatility multiplier; defaults to 2                                      |
| `MARKET_BASELINE_MIN_SNAPSHOTS`                         | stocks bot            | Minimum stored volume snapshots before relative-volume detection; defaults to 5                          |
| `OPTIONS_VOLUME_OI_ANOMALY_THRESHOLD`                   | stocks bot            | Contract option-volume/open-interest anomaly ratio; defaults to 2                                        |
| `OPTIONS_VOLUME_BASELINE_MULTIPLIER`                    | stocks bot            | Aggregate options-volume anomaly versus recent baseline; defaults to 3                                   |
| `OPTIONS_BASELINE_MIN_SNAPSHOTS`                        | stocks bot            | Prior option snapshots required for an aggregate-volume baseline; defaults to 3                          |
| `INSTITUTIONAL_CHANGE_THRESHOLD_PERCENT`                | stocks bot            | Absolute institutional holdings-change threshold; defaults to 5%                                         |
| `SHORT_INTEREST_CHANGE_THRESHOLD_PERCENT`               | stocks bot            | Absolute reported short-interest change threshold; defaults to 10%                                       |
| `SHORT_INTEREST_DAYS_TO_COVER_THRESHOLD`                | stocks bot            | Days-to-cover threshold for a short-interest anomaly; defaults to 5                                      |
| `DISCOVERY_MARKET_DATA_ENTITLEMENT`                     | stocks bot            | `EOD`, `DELAYED`, or `REALTIME`; must match the key's market-data entitlement                            |
| `STOCKS_MONITOR_SCHEDULE`                               | stocks bot            | Cron schedule for watched-stock news checks; defaults to every five minutes                              |
| `DISCOVERY_WEEKLY_SCHEDULE`                             | stocks bot            | Sunday market-wide discovery report, default 15:00 local time                                            |
| `DISCOVERY_MOVE_THRESHOLD_PERCENT`                      | stocks bot            | Minimum absolute move for a discovery candidate; defaults to 4%                                          |
| `DISCOVERY_MIN_PRICE`                                   | stocks bot            | Minimum candidate price; defaults to 2                                                                   |
| `DISCOVERY_MIN_VOLUME`                                  | stocks bot            | Minimum current snapshot volume; defaults to 100,000                                                     |
| `DISCOVERY_MIN_DOLLAR_VOLUME`                           | stocks bot            | Minimum price × volume; defaults to 1,000,000                                                            |
| `DISCOVERY_MAX_CANDIDATES`                              | stocks bot            | Maximum candidates investigated per market-wide scan; defaults to 10                                     |
| `DISCOVERY_SUPPORTED_EXCHANGES`                         | stocks bot            | Comma-separated SEC exchange names accepted by discovery                                                 |
| `DISCOVERY_EXCLUDE_OTC`                                 | stocks bot            | Reject SEC profiles whose exchange contains `OTC`; defaults to true                                      |
| `DISCOVERY_INVESTIGATION_MINUTES`                       | stocks bot            | Time allowed for a temporary investigation; defaults to 90 minutes                                       |
| `DISCOVERY_HIGH_RESOLUTION_INTERVAL_MINUTES`            | stocks bot            | Interval for SEC/IR/TradingView/price checks while escalated; defaults to 5 minutes                      |
| `DISCOVERY_EVENT_MODE_MINUTES`                          | stocks bot            | Duration of event-mode polling after material evidence; defaults to 120 minutes                          |
| `DISCOVERY_WATCH_DAYS`                                  | stocks bot            | Watch lifetime after automatic promotion; defaults to 14 days                                            |

Infrastructure secrets cannot be edited through Telegram. Telegram-editable schedules, watchlists, query lists, news feeds/topics, and source switches are persisted in PostgreSQL.

Maintenance Ollama anomaly settings are `OLLAMA_CPU_ALERT_PERCENT=150`, `OLLAMA_HIGH_USAGE_DURATION_SECONDS=180`, `OLLAMA_CPU_GPU_IMBALANCE_ENABLED=true`, `OLLAMA_CPU_GPU_IMBALANCE_DURATION_SECONDS=120`, `OLLAMA_CPU_GPU_SHARE_MARGIN_PERCENT=20`, `OLLAMA_GPU_LOW_UTIL_PERCENT=20`, `OLLAMA_REQUEST_TIMEOUT_SECONDS=300`, `OLLAMA_QUEUE_ALERT_SIZE=10`, `OLLAMA_QUEUE_WAIT_ALERT_SECONDS=180`, and `OLLAMA_ALERT_COOLDOWN_SECONDS=900`. The per-request hard timeout remains `OLLAMA_TIMEOUT_MS` in each Ollama caller.

## Telegram commands

Stocks and Publications support `/about`, `/start`, `/help`, `/status`, `/list_sources`, `/schedule [CRON] [TIMEZONE]`, `/run`, `/pause`, and `/resume`. News supports the common lifecycle commands plus profile-aware feed and topic configuration. Reality supports the common lifecycle commands plus `/locations`, `/location_add`, `/location_remove`, and `/model`. `/help` prints an alphabetized command list. Stocks `/about` sends a three-part Czech beginner's guide covering setup, thesis interpretation, monitoring tiers and modes, practical research workflows, scheduling, and paper-only risk profiles; other bots' `/about` messages explain their purpose and workflow.

Manual `/run` requests first send one progress message, then update that message with `editMessageText` while sources are fetched, items are prepared, and Ollama analyses run. Run digests use Telegram formatting with clear item separators, labeled summary and detail sections, bullet lists, source links, and total run time. Link previews are disabled to keep multi-item digests compact.

Stocks bot:

- `/stocks` to show labeled per-stock state plus currently watched, configured, paused, and auto-discovered counts; `/stocks_tickers` returns only enabled ticker symbols, one per line
- `/allocation [--amount-czk AMOUNT] [--days DAYS]` to rank stored stock research for a 1–365 day horizon and optionally distribute a whole-CZK research budget among model-eligible tickers; the selected horizon must have a better-than-even stored probability before it receives money, no trade is executed, and the budget remains unallocated when evidence is insufficient
- `/dashboard` to show the latest state of every enabled stock
- `/opportunities` to show elevated-attention or favorable-asymmetry stocks
- `/alerts` to show recent generated alerts and delivery state
- `/health` to show run, reconciliation, source, LLM, latency, and queue metrics
- `/replay SYMBOL DATE` for a strict historical as-of view that excludes later-known information
- `/event_replay SYMBOL [FROM] [TO]` for the chronological event and thesis-transition stream
- `/validate` to match stored theses, alerts, and signals to stored price outcomes
- `/backtest`, `/calibration`, and `/signal_performance` for validation reports
- `/reaction SYMBOL` to distinguish a stored post-event price observation from a confirmed event-to-reaction link or an unexplained move
- `/paper_open SYMBOL --amount-czk AMOUNT [--days DAYS]`, `/paper_portfolio`, and `/paper_close NUMBER` for a persistent, no-execution paper ledger that preserves the entry thesis and evaluates it only against stored prices
- `/portfolio_risk` to audit paper-notional concentration, sector overlap, research coverage, stale stored prices, and reached holding horizons before acting on a research signal
- `/risk_profile [PROFILE]` to persist conservative, balanced, or aggressive paper-portfolio warning limits; custom ticker, sector, and total-notional limits only adjust warnings and never execute a trade
- `/alpaca` to view an optional Alpaca **Paper** account, its positions, and its five latest orders; it is read-only and cannot submit, modify, or cancel orders
- `/trading212` to view the real or demo Trading 212 account and every open position; `/trading212_report` for a concise value, P/L, and allocation report; `/trading212_setup` shows your owner user ID
- `/reconcile` to run the comprehensive recovery scan now
- `/catalysts [SYMBOL]` to list active and upcoming catalyst records with evidence
- `/earnings SYMBOL` to show the stored next-report setup and latest EPS/revenue expectation-versus-actual comparison; run `/thesis SYMBOL` first when no source snapshot is stored
- `/peers SYMBOL` to show the curated peer and sector context map for CRDO, MU, SNDK, and DOCN; it never asserts an unverified customer or supplier relationship
- `/valuation SYMBOL` to refresh Nasdaq price and market capitalization on demand, then show stored provider forward P/E and earnings consensus without treating a multiple as a buy/sell conclusion; if Nasdaq is unavailable, existing stored values remain the fallback
- `/cashflow SYMBOL` to fetch the watched company's latest standardized SEC Company Facts cash-flow figures: latest interim fiscal-year-to-date period and up to three annual periods, with operating/investing/financing cash flow, capex, and calculated free cash flow when both inputs are available; each period includes the filing date and SEC accession
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
- `/news SYMBOL RANGE [--json]` to list only saved stock-news articles by publication time, newest first; use `24h`, `3d`, `7d`, `30d`, or explicit ISO `FROM TO` timestamps. `--json` uploads a JSON document containing full stored descriptions and analysis instead of sending the compact Telegram digest.

`/cashflow` reads the official [SEC Company Facts API](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) on demand using `SEC_USER_AGENT`; it does not depend on an Ollama analysis or persist a separate financial snapshot. The interim line is fiscal-year-to-date, never an inferred standalone quarter. Free cash flow is operating cash flow minus reported capex from the same filing and period; missing capex remains unavailable rather than zero. Standardized US-GAAP tags are not available for every issuer, particularly some foreign filers.

### Trading 212 portfolio setup

The optional Trading 212 integration reads only the official account-summary and open-position endpoints for an Invest or Stocks ISA account. It never sends an order, does not merge real positions with Watcher's paper ledger, and does not copy the account into the stock watchlist. The Telegram reports are factual snapshots, not trading recommendations. The API is in beta, so a changed response shape fails closed instead of showing invented totals. [Trading 212 API reference](https://docs.trading212.com/api/positions), [account summary](https://docs.trading212.com/api/accounts/getaccountsummary).

1. In a private chat with Stocks Bot, run `/trading212_setup` and note your Telegram user ID. This ID must also be present in `TELEGRAM_ALLOWED_USER_IDS`.
2. In the Trading 212 web or mobile app, open **Settings → API (Beta) → Generate API key**. Choose read-only account-data and portfolio/positions permissions only; do not grant order placement. If you enable the recommended IP restriction, enter the VPS's public outbound IP address, not its Tailscale address. Save the API Secret when it is shown once. [Trading 212 key instructions](https://helpcentre.trading212.com/hc/en-us/articles/14584770928157-Trading-212-API-key).
3. On the VPS, put `TRADING212_API_KEY`, `TRADING212_API_SECRET`, `TRADING212_TELEGRAM_USER_ID`, and `TRADING212_ENVIRONMENT=LIVE` (or `DEMO` for a demo key) in `/opt/watcher/deploy/runtime/stocks-bot.env`. Keep that file mode `0600`. Never send the credentials to Telegram, put them in `.env.example`, commit them, or add them to GitHub Actions secrets.
4. Deploy the updated Watcher image through the normal production workflow so the stocks-bot process restarts with these variables. Test `/trading212` for all positions and `/trading212_report` for a concise report. A 401/403 generally means incorrect credentials, missing read permissions, wrong environment, or an IP restriction that excludes the VPS. Leaving both credentials empty disables the integration.
5. Optionally run `/trading212_schedule on` in the same private chat. The bot sends the same positions view as `/trading212` at approximately 09:25 and 09:35 New York time on weekdays, accounting for daylight saving time. `/trading212_schedule status` shows the PostgreSQL-backed setting; `/trading212_schedule off` disables it and cancels pending scheduled messages. This simple weekday schedule does not query an exchange holiday calendar, so holiday weekdays can still produce a report. Manual `/trading212` remains available regardless of the setting.

The maintenance agent also announces each successfully promoted production release. CI prepares up to 20 commit subjects since the previous release; `deploy/deploy.sh` publishes the announcement only after the core services pass health checks. The agent reads the promoted file every 30 seconds and deduplicates by release SHA and chat ID in PostgreSQL. Failed rollouts are not announced. The hand-maintained changelog remains a separate source of one-time project updates.

Publications bot:

- `/queries`
- `/add_query TOPIC`
- `/add_queries` to import multiple topics from a CSV attachment
- `/remove_query TOPIC`
- `/sources` to toggle PubMed, bioRxiv, ClinicalTrials.gov, and openFDA globally for all current and future queries
- `/list_sources` to list available publication sources and provider links

News bot:

- `/categories` to list delivery categories separately for Czech and Global; `SPORT` is disabled by default in both profiles
- `/category_enable PROFILE CATEGORY` and `/category_disable PROFILE CATEGORY` to persistently change delivery
- `/feeds` to list the automatically configured Global sources with their stable IDs (the Czech profile is disabled)
- `/feed_enable ID` and `/feed_disable ID` to control built-in or custom sources
- `/feed_add global URL [NAME]` and `/feed_remove ID` for optional custom RSS/Atom feeds; built-in sources cannot be removed
- `/topic_add PROFILE TOPIC`, `/topic_remove PROFILE TOPIC`, and `/topics`
- `/run` to process both profiles, or `/run czech` / `/run global` for one profile
- `/schedule`, `/status`, `/pause`, and `/resume` for the shared persisted runner

MU Clubs monitor:

- `GET /activities` lists persisted normalized club activities; filters include `since`, `club`, `minImportance`, and `limit`
- `GET /briefing` returns the last 24 hours of briefing-worthy activities by default
- `GET /clubs` shows active, unsupported, and excluded club/source registry entries
- `POST /run` invokes the same source pipeline used by the scheduler
- These endpoints require `Authorization: Bearer $MU_CLUBS_API_TOKEN`; only `GET /healthz` is unauthenticated

Brno Events Agent:

- Polls Meetup, GoOut, VisitBrno/TIC, MUNI, VUT, JIC, and CEITEC through isolated provider-specific API, embedded-data, paginated HTML, and JSON-LD fallback adapters
- Normalizes, scores, and cross-source deduplicates upcoming Brno events while retaining every source link
- Exposes `/events`, `/events/upcoming`, and structured `/events/briefing` payloads plus manual source runs
- Requires `Authorization: Bearer $BRNO_EVENTS_API_TOKEN` except for `GET /health`; see [source and API details](docs/brno-events-agent.md)

Personal Morning Briefing bot:

- `/start` to begin or resume persisted onboarding; Google Calendar is an optional integration and does not block setup
- `/briefing` and `/briefing_test` to generate a full or short briefing now
- `/goal_add YYYY-MM-DD Goal title`, `/goal_remove ID`, and `/goals` to manage private goals and their deadline countdowns
- `/briefing_settings`, `/briefing_time HH:mm[;HH:mm|weekly:DAY:HH:mm]`, `/briefing_duration MINUTES`, `/briefing_max_duration MINUTES`, and `/briefing_transcript on|off`
- `/subscriptions`, `/subscribe WATCHER`, `/unsubscribe WATCHER`, `/subscribe_all`, and `/unsubscribe_all`
- `/location_set CITY`, `/location_clear`, and `/location_status`
- `/voice_list`, `/voice_set VOICE`, and `/voice_preview VOICE`
- `/calendar_connect`, `/calendar_status`, `/calendar_refresh`, and `/calendar_disconnect`
- `/agents` to list triggerable producers and `/trigger AGENT [SOURCE]` to run one; for example `/trigger brno-events goout`
- `/schedules` to inspect Stocks, Publications, News, MU Clubs, Brno Events, and Briefing timing and verify which producers run before the next briefing

`/trigger stocks`, `/trigger medical`, and `/trigger news` persist an immediate due time and the producer's existing scheduler claims the run on its next tick. `/trigger mu-clubs` and `/trigger brno-events [SOURCE]` call their authenticated internal manual-run endpoints and return completion counters; the Brno run includes event relevance evaluation.

Multiword Telegram command names use underscores. Legacy concatenated stock/publication names remain accepted as aliases, and legacy briefing commands typed with hyphens are normalized to their underscore equivalents.

Manual and test briefings can run with the saved settings and safe defaults before onboarding is complete. Scheduled delivery starts only after onboarding is completed. Google Calendar is optional; an unconnected calendar simply contributes no calendar events. The briefing scheduler uses the configured IANA timezone and a PostgreSQL claim, while manual/test runs have independent windows. Delivery schedules accept semicolon-separated local times, plus weekly entries in `weekly:DAY:HH:mm` format where `DAY` is `MON` through `SUN`; weekly entries use a 7-day briefing window and win over daily entries at the same local time. The default is `07:00;20:00;weekly:MON:07:00;weekly:SUN:20:00`, which gives normal morning/evening briefings plus full-week briefings on Monday morning and Sunday evening. Use `/briefing_time default` to restore it. Every run derives morning, afternoon, evening, or night from the user's configured timezone and local generation time; the spoken greeting, closing, watch horizon, and Telegram index use that period even if the LLM suggests a mismatched greeting. Evening and night runs are end-of-day briefings: they report only new or materially updated developments since an earlier briefing, then present tomorrow's Calendar and preparation agenda. Already narrated morning news is not repeated without fresh event evidence. Explicit weekly windows remain weekly. Morning and afternoon runs use today's Calendar. The bot collects the newest subscribed watcher events in the briefing window before clustering and ranking, so large producer batches cannot push fresh developments out of the candidate set. It clusters related Stocks, Medical, News, MU Clubs, and Brno Events, suppresses unchanged stories in every day period, selects to a variable spoken-word budget, and uses Piper for OGG/Opus audio. TTS segmentation keeps English narration in the English voice even when it mentions a Czech place, and switches known English event titles and company names back to English inside Czech narration. A successful delivery sends the voice note with explicit duration metadata followed by a separate compact HTML index, keeping long topic links out of Telegram's narrow voice-caption bubble; the optional transcript is a third message. Failed weather, Calendar, script, TTS, source, or Telegram stages degrade independently. Voice upload exhaustion falls back to text. Every run persists producer health, enabled-input coverage, selection/noise counts, stage latency, voice, word count, planned duration, audio duration, and delivery failures.

Stock and publication source switches are global within their respective bot. Every source is enabled initially; `/sources` changes it for all current entries and saves the same setting for entries added later. Cron expressions use five fields; an optional final IANA timezone may be supplied. In the stocks bot, `/schedule_list` shows numbered schedules, `/schedule_add CRON` appends one in the current timezone, and `/schedule_remove NUMBER` removes one without replacing the others. Use `/pause` instead of removing the final schedule. `/schedule` remains the replace-all command and can also change the shared timezone: `/schedule 0 8 * * * Europe/Prague`. Multiple expressions can be supplied at once with semicolons, for example `/schedule 0 7 * * 1-5; 30 8 * * 1-5; 0 20 * * 1-5 America/New_York`.

### Stocks

Targeted stock analysis requires explicit thesis-change and information-change classifications. If an otherwise valid Ollama response omits or malforms only those two labels, the analyzer makes one bounded, evidence-grounded classification repair request and validates both values before updating a thesis. It never substitutes a neutral or positive classification automatically. Structured-attempt logs record only invalid field names and value kinds, not article text or raw model output.

The watchlist starts empty. `ELAN`, `CVS`, `NVO`, `PFE`, and `BMY` are examples only; none is seeded or mandatory. Add only the symbols you want with `/add_stock`. When a stock is added, Watcher resolves the ticker through SEC EDGAR, stores the company name and CIK, and shows the company name in `/stocks` and stock run digests. `/thesis SYMBOL` refreshes all enabled live sources only for that configured ticker before showing the updated thesis; if no thesis exists, it may initialize one from the strongest available event and the accumulated event context. If another watcher run is active, `/thesis` waits and automatically starts its targeted refresh when the run lock becomes available. The same Telegram progress message updates every 10 seconds with the elapsed time while waiting and running. A second request for the same ticker in the same chat points to the existing progress message; a bot restart interrupts pending requests, which must then be sent again. If analysis fails, the bot reports a safe failure category; the full error is in the stocks-bot log, and failed events can be retried with `/thesis SYMBOL` without waiting for new news. This on-demand refresh does not send a second manual-run digest and does not weaken scheduled-run materiality gates. `/earnings SYMBOL` displays the newest persisted Earnings Whispers observation, separating the next report setup from the provider's latest reported EPS/revenue expectation-versus-actual comparison. Known exact upcoming quarterly earnings dates for watched stocks appear in every Stocks-subscribed briefing for the next 14 local calendar days; older one-week and one-day reminders are not narrated separately.

Available stock sources are SEC EDGAR, issuer RSS/Atom feeds auto-discovered from SEC company metadata, TradingView symbol news, company intelligence, FINVIZ insider transactions, Zacks rank/quote snapshots, Earnings Whispers earnings snapshots, Nasdaq daily price, FINRA short interest, ClinicalTrials.gov, openFDA Drugs@FDA, Alpha Vantage institutional/options data, and six optional Quiver datasets. Company intelligence is a curated, first-party scraper for `CRDO`, `MU`, `SNDK`, and `DOCN`: it checks the company’s own announcements and selected sector peers every 15 minutes, while the ordinary headline sources remain on the five-minute cadence. Micron newsroom extraction selects its article teasers and trusted investor-release links, not product-navigation links. It fetches a bounded excerpt from each linked public article when available; otherwise it explicitly marks the observation as headline-only instead of adding generic prose. Listing and article-fetch failures are logged by endpoint without logging page content. Peer announcements are stored as `COMPETITOR_EVENT`, never as the watched company’s own earnings or filing. Every current source switch is enabled initially. Credential-backed switches remain dormant when their server credential or entitlement flag is absent. Provider URLs are built into the bot; use `/sources` to change a source globally for all existing stocks and as the default for stocks added later. The retired `NEWS` enum and historical records remain in PostgreSQL for rollback compatibility, but no GDELT requests are scheduled or shown in `/sources` or `/health`.

Each manually added company has an independent monitoring tier (`CORE`, `WATCH`, `DISCOVERY`, or `INVESTIGATE`), monitoring mode (`LOW_RESOLUTION`, `NORMAL`, `HIGH_RESOLUTION`, or `EVENT_MODE`), priority, enabled state, optional watch reason, and optional expiry date. Watched-stock news checks run every five minutes by default.

When `ALPHA_VANTAGE_API_KEY` is configured, a weekly Sunday schedule reads Alpha Vantage's top gainers, losers, and most-active snapshot without using Ollama. Price, current volume, dollar-volume, ticker-format, SEC resolution, supported-exchange, and OTC filters reduce low-quality candidates. It sends a short candidate report before evening and never creates, enables, or investigates a stock automatically. Add a candidate explicitly with `/add_stock SYMBOL` to begin five-minute news monitoring. Provider snapshot identity and PostgreSQL constraints prevent duplicate candidate reports from the same market snapshot.

Stock observations now pass through event intelligence before Ollama. Watcher creates canonical events with a backwards-compatible primary `eventType` plus multiple `eventTypes`, merges cross-source confirmations, records every evidence item and event chain, and re-evaluates materiality after market enrichment. HIGH/EXTREME is a hard analysis invariant and bypasses the ordinary per-run analysis cap; failures are recorded explicitly rather than displayed as intentional skips. Routine Form 4/Form 144 observations remain low-materiality state updates. See [Hybrid stock events](docs/stock-hybrid-events.md).

Phase 4 adds structured insider classification and conviction scoring, 30-day purchase-cluster detection, a persistent catalyst registry, stored market baselines, price/gap/volume/volatility anomalies, and unknown-cause investigation escalation. Form 4 facts from SEC, FINVIZ, and Quiver share one classifier and fingerprint, so confirmations do not multiply the signal. Market anomalies never receive a bullish/bearish direction merely from price or volume; they are linked to a recent material event when one exists and otherwise remain explicitly unexplained. `/catalysts` exposes the active registry, including timing, impact, direction, and primary evidence.

Phase 5 adds targeted event analysis, primary-driver/redundancy classification, weighted signal groups, source-aware data coverage, change detection, and persistent versioned thesis state. Ollama prompts use a bounded source excerpt and compact prior-event context to fit the configured context window; the complete source evidence remains persisted. Stock structured generation uses temperature zero and logs each first/repair attempt with its model, stage, validation result, missing/invalid field paths, input/output lengths, and token-limit status, without logging the generated text. This lets operators distinguish a truncated answer from a schema mismatch or request failure and measure repair success. Stock validation safely extracts explicit text from common object-shaped driver and risk fields and interprets unambiguous 0–100 confidence percentages as 0–1 scores; it never fills missing causal claims or silently drops unrecognized risk objects. Required causal explanation, risks, and confidence must still validate before any thesis is stored. Scenario decision inputs are optional when the evidence cannot support them; their absence does not invalidate an otherwise sourced thesis, but the decision remains unavailable. Full Ollama analysis is skipped when targeted analysis finds no meaningful thesis change. `/thesis SYMBOL` shows the latest thesis, confidence, attention, bull/bear/net scores, catalysts, risks, and material data gaps.

For a material stock event, the full thesis response gets one attempt. If its JSON is invalid or incomplete, Watcher makes a shorter, separately validated `stock_full_compact` request using a bounded source excerpt and the already validated targeted assessment. The compact response must supply its own thesis, verdict, risks, confidence, and primary drivers; all other display fields are deterministically derived from source/event context and the targeted assessment. It never turns a failed targeted analysis into a thesis. Scenario decision inputs are unavailable on this compact path, and a second malformed response leaves the event failed and retryable. Transport or Ollama request failures do not trigger this extra model call. This prevents repeated full-schema repair prompts from exhausting a 4096-token context window while keeping the evidence gate intact.

Phase 6 adds validated bull/base/bear scenarios, broad probability ranges, scenario-weighted expected value, asymmetry, priced-in analysis, deterministic recommendation gates, and conservative maximum position ranges. Missing data never becomes neutral evidence: coverage below 50%, confidence below 45%, or absent probability support produces `INSUFFICIENT_DATA` and a 0% suggested position. Every result requires human review and is not an automatic trade instruction.

Phase 7 adds durable live alerts for high/extreme events, threshold crossings, thesis/verdict/asymmetry changes, insider clusters, extreme catalysts, and unexplained activity. Alert generation is unique per watcher/event, delivery failures remain pending for retry, and every alert links to its evidence while explicitly avoiding leak or guaranteed-trade claims. A persisted daily reconciliation runs the same source and deduplication pipeline, clears expired source backoff for a recovery attempt, and analyzes only meaningful new canonical events. Telegram `/dashboard`, `/opportunities`, `/alerts`, and `/health` provide the operational and decision overview without adding a web UI.

Phase 8 adds persisted option-chain positioning, institutional holdings, FINRA consolidated short interest, company-matched ClinicalTrials.gov studies, openFDA Drugs@FDA submissions, and Quiver lobbying. Deterministic thresholds suppress ordinary positioning snapshots before Ollama; unusual options and short-interest activity remains direction-unknown and delayed institutional reports do not imply current intent. Credential-backed sources that are not actually instantiated are excluded from thesis data coverage. See [the Phase 8 design](docs/stock-intelligence-phase-8.md).

Phase 9 adds strict historical and chronological event replay plus persisted outcome validation for theses, alerts, and individual signal types. Backtests report stored 1-hour, 1/7/30/90-day, and 12-month returns together with hit rate, mean/median return, MFE, and MAE; unavailable horizons remain unavailable. Probability calibration uses fixed 30-day buckets, and low-sample signal groups are clearly marked instead of being used to tune weights automatically. See [the Phase 9 design](docs/stock-intelligence-phase-9.md).

### Publications

The query list also starts empty. Add a topic such as `/add_query mycorrhizal fungi`; it is stored exactly for display and in normalized form for duplicate protection. To import many topics, upload a CSV file with a `query` or `topic` column and reply to it with `/add_queries`, or attach the CSV with `/add_queries` as the document caption. If no header is present, the first column is used. PubMed, bioRxiv, ClinicalTrials.gov, and openFDA are enabled initially. Use `/sources` to disable or enable a provider globally for all existing queries and as the default for queries added later.

### News

The News Bot automatically provisions a built-in source catalog for every existing and new chat. The Czech profile is retired and remains disabled. The active Global profile includes BBC News, The Guardian, Al Jazeera English, NPR, Financial Times, Bloomberg, The Economist, Politico Europe, Nature News, Science, MIT Technology Review, Ars Technica, WHO, European Commission, ECB, NASA, and ESA. Every active built-in uses its public RSS/Atom feed. Reuters, AP, Euractiv, IEA, and the broad GDELT feed were GDELT-only entries and have been retired; their persisted feed settings are disabled and hidden, while historical news remains stored. Active built-in sources can be disabled and re-enabled but not removed. Optional custom feeds remain supported.

Topics still start empty and steer relevance ranking within their profile; with no topics, Ollama assesses general public significance. Delivery categories are persisted separately for Czech and Global. `SPORT` defaults to disabled in both, and disabled categories are suppressed from manual digests, scheduled digests, and Briefing input even when Ollama gives them high importance or relevance. RSS entries with an explicit disabled category are removed before analysis; post-analysis filtering remains the authoritative guard for feeds without category metadata. Source responses are normalized and deduplicated through the shared watcher pipeline, while important, relevant, and enabled stories are published to the Briefing Bot as durable `news` events. The Briefing Bot embeds those events in its existing `briefing_events` pgvector columns and uses semantic similarity as secondary evidence when grouping cross-publisher or cross-language coverage; broad News profile/category tags alone never merge stories. Identical substantive headlines can still form one story without extracted entities. The spoken script requires one paragraph for each selected story ID, and its preview gives only the count, avoiding a second narration of the same event. Enable or disable the `news` subscription from the Briefing Bot independently of the News Watcher's own schedule.

## Source support and limitations

- **SEC EDGAR:** fetches the company ticker directory, recent submissions, and filing documents. `SEC_USER_AGENT` is mandatory and requests are paced. It selects up to 10 recent material filings per run, including 8-K, 10-Q, 10-K, 6-K, Form 4, S-1/S-3, SC 13D/13G, foreign annual reports, merger proxies, and material offering documents. Amended forms are included. It does not backfill older filing-history pages.
- **Investor relations:** reads the issuer URL exposed by SEC submissions metadata, safely auto-discovers an advertised RSS/Atom feed, and consumes it when present. If the issuer exposes no URL or feed, this source returns no items.
- **Federal Register:** searches the official, keyless API over the last 90 days and verifies the tracked company's full name against each candidate's official document text before storing it. It covers company-specific notices from USITC (including published Section 337 complaints, investigations, and orders), FTC, DOJ, Commerce/BIS, Treasury/OFAC, FDA, and USPTO. It is not a substitute for the USITC EDIS docket, OFAC designation list, patent litigation dockets, or broad industry-rule monitoring when a rule does not name the company. Each item keeps the issuing agencies and document number as provenance. The Federal Register's HTML rendition is informational; use its linked official PDF for legal verification.
- **FTC / DOJ:** official RSS adapters monitor FTC competition press releases and DOJ Antitrust Division announcements. They require a verified company-name mention in the feed entry and an official-domain article link. Unannounced investigations, unrelated releases, and company mentions only in linked full articles are not captured by these feed adapters. Commerce's published RSS URL currently returns HTTP 403, so Commerce/BIS coverage comes from official Federal Register notices rather than a claimed live Commerce press feed. These three agency adapters run alongside SEC when `/sources SEC` is enabled; they do not yet have independent Telegram switches, avoiding incompatible new enum values during application-image rollback.
- **PR distribution and Reuters:** Business Wire, GlobeNewswire, PR Newswire, and Reuters links may appear in TradingView or issuer feeds when those providers return them. They are secondary evidence, not guaranteed dedicated feeds, and are not promoted above matching SEC, issuer IR, or official government records. No licensed Reuters API or restricted wire service has been added.
- **TradingView News:** queries TradingView's symbol headline feed for each watched stock using the exchange-qualified ticker, then links to the TradingView story page and uses available article-page text as analysis context. TradingView HTML or headline endpoints may change or throttle automated requests.
- **FINVIZ:** reads the public ticker quote page's insider-trading table and normalizes up to five recent rows. It links each result to the underlying SEC filing. FINVIZ HTML may change or throttle automated requests.
- **Zacks:** reads the public JSON quote feed used by the ticker page and emits a new snapshot when its visible Zacks Rank or quote facts change. The snapshot includes rank, price/change, forward P/E, and confirmed earnings date when provided. It does not access subscriber-only reports.
- **Earnings Whispers:** establishes the anonymous session used by the public ticker page, then reads its public earnings endpoints. It combines the next earnings date and estimates with the latest reported EPS/revenue surprise into one snapshot. It does not access subscriber-only data; the public endpoints may change or throttle automated requests.
- **Alpha Vantage discovery:** uses the documented `TOP_GAINERS_LOSERS` endpoint as an optional aggregate market scanner. The default `EOD` mode is appropriate for daily discovery; delayed or real-time operation requires the matching provider entitlement. This endpoint does not provide market capitalization or historical average volume, so Phase 3 filters current snapshot liquidity and exchange eligibility instead of inventing those values. See the [official Alpha Vantage API documentation](https://www.alphavantage.co/documentation/).
- **Alpha Vantage advanced data:** institutional holdings use `INSTITUTIONAL_HOLDINGS` when an API key exists. Realtime option chains use `REALTIME_OPTIONS` only when `ALPHA_VANTAGE_OPTIONS_ENABLED=true`; the provider marks realtime options as premium. API responses are aggregated locally and the key is never stored in observations or URLs.
- **FINRA short interest:** uses FINRA's public consolidated-short-interest dataset with an exact ticker filter. Reports are periodic and delayed, so a change or high days-to-cover value is contextual rather than a directional trade signal.
- **ClinicalTrials.gov / openFDA:** company-name searches use official APIs for sponsor/collaborator trials and Drugs@FDA submissions. For companies whose SEC industry identifies life sciences, FDA also checks official drug and device enforcement reports for recalls, verifying the recalling firm's name before storage. Public Complete Response Letters and FDA safety communications without a matching structured record are not guaranteed. Corporate aliases and subsidiaries can cause incomplete matches; no result is treated as missing data.
- **Quiver Quantitative:** optional bearer-authenticated adapters use the documented insider, government-contract, patent, congressional-trading, off-exchange, and lobbying endpoints. Provider observations are secondary evidence and context, not automatic buy/sell signals. SEC Form 4 observations outrank matching Quiver insider rows as primary evidence. Access tier, retention, redistribution, and polling frequency must follow the operator's current Quiver subscription and terms. See the [official Quiver API documentation](https://api.quiverquant.com/docs/) and [terms](https://www.quiverquant.com/termsofservice/).
- **PubMed:** uses NCBI E-utilities search and XML fetch endpoints.
- **Price:** uses Nasdaq's public daily historical OHLCV data and creates one price item per trading date. `/valuation SYMBOL` also requests Nasdaq's public quote and market-cap summary on demand, falling back to stored values if either request fails. These website endpoints can change without notice; malformed responses fail validation instead of becoming invented prices.
- **bioRxiv:** queries the official API over a recent date window and filters matching title/abstract text.
- **ClinicalTrials.gov:** uses the v2 structured API.
- **openFDA:** searches drug adverse-event reports by generic drug name; a provider 404 is treated as no results.
- **News RSS/Atom:** reads the built-in official feeds and optional operator-configured public feed URLs. Initial URLs and every redirect are checked against private, loopback, link-local, and special-purpose network targets. Analysis uses the feed-provided title and summary; it does not scrape arbitrary linked article pages.

External APIs can change, throttle, or return incomplete data. One source failure does not cancel other source results and is included in the run record and digest. Requests are coordinated by a shared limiter for each provider: PubMed serializes every NCBI E-utilities request at no more than one per second, bioRxiv reuses one provider response across all queries for 30 minutes, and all Alpha Vantage or Quiver adapters share their provider's queue. DNS failures, timeouts, transport resets, supported HTTP 5xx responses, and malformed or truncated payloads receive up to three attempts with one- and two-second delays. Client errors and rate limits are not retried blindly. A shared provider failure is grouped across affected publication queries in the Telegram digest instead of being repeated once per query. The first rate-limit response pauses queued calls for that provider, honors `Retry-After` when supplied, and persists the provider-wide backoff so later runs and other Telegram users do not immediately retry it. Other source failures retain bounded target-specific exponential backoff; a later successful check restores healthy status. The system does not invent fallback content.

Ollama responses are requested as structured JSON and validated with Zod. The parser safely extracts JSON from Markdown fences or leading commentary. Malformed output gets a small bounded corrective retry containing the validation problem and twice the previous output-token budget, up to 8192 tokens. `done_reason`, token counts, and unfinished JSON structure distinguish truncation so the repair prompt can say that the response was cut off. Publication output also normalizes safe model deviations such as known field aliases, a single string where a string array is required, numeric strings, and decimal or out-of-range scores. It does not invent missing summaries or scores; persistent failures are stored as failed analyses instead of crashing the run. Source content is truncated before it is sent to the model.

## Ollama resource protection

Watcher intentionally does not add Redis for Ollama coordination. PostgreSQL already belongs to the system and provides a persisted priority queue plus one global transaction-scoped advisory lock shared by every bot container. Every chat generation and embedding request uses that coordinator, so the default global inference concurrency is one. Briefing requests have high priority; stocks, news, and publications use normal priority. Analysis therefore has five layers of protection:

1. Sources may fetch concurrently, but expensive LLM analyses are sequential inside each run.
2. The PostgreSQL queue and advisory lock permit only one Ollama request across watcher producers at a time. Queue wait, caller, model, timeout, input/output size, duration, and outcome are logged as structured events. Transaction release and a hard request timeout prevent a failed worker from permanently owning the slot; stale persisted telemetry is expired automatically.
3. Canonical event deduplication, materiality, and persisted cooldowns reject redundant or low-value stock work before Ollama.
4. `OLLAMA_MAX_ITEMS_PER_RUN` caps eligible analyses after the stock materiality gate. The default `0` processes every eligible stock or news event. Publications always analyze and deliver at most 15 papers per run; a lower positive setting is honored. Candidate papers are selected round-robin across query topics with a run-specific rotation and newest-first ordering within each topic, preventing alphabetical topics from monopolizing successive runs. Unselected papers are not marked as delivered and can be discovered in a later run.
5. Context, output length, timeout, retry count, thinking, and model keep-alive are bounded by environment variables.

The default prioritizes complete overnight stock and news runs over digest speed, while Publications has a fixed 15-paper safety cap. Set `OLLAMA_MAX_ITEMS_PER_RUN` to a positive lower value if you need a tighter bound after observing free RAM/VRAM and run duration. Lower `OLLAMA_KEEP_ALIVE` to `0` when RAM is scarce and slower model reloads are acceptable.

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

The maintenance agent reads host CPU/process data through the existing read-only `/proc` and `/sys` mounts and queries host Ollama `/api/ps` through `host.docker.internal`. It does not need privileged mode or the Docker socket. Alerts use application-level active/queued request state, not TCP connection counts: several `ESTABLISHED` keep-alive sockets are therefore not considered concurrent inference. It warns on multiple active jobs, sustained Ollama CPU, sustained CPU-heavy model placement or low GPU use, stuck requests, and queue backlog. A small serialized queue is not treated as a backlog before the active request's declared timeout, and queued normal work ages into FIFO order after 30 seconds so high-priority briefing calls cannot starve it. A single cooldown deduplicates repeated warnings and one recovery message is sent when usage returns to normal.

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
  news-bot/               general-news Telegram workflows and source orchestration
  reality-bot/            housing-market reporting and real-estate opportunity monitoring
  mu-clubs-monitor/       public club activity monitoring, API, classification, and scheduling
  brno-events-agent/      Brno event discovery, normalization, deduplication, scoring, and API
  briefing-bot/           scheduled personalized audio briefings and calendar integration
  maintenance-agent/      deterministic health and quality evaluation, API, scheduler, and Telegram reports
packages/
  core/                   cross-bot pipeline, event bus, scheduling, networking, and common types
  database/               Prisma schema, migrations, client, persistence store
  sources/                reusable source infrastructure: Instagram, safe public HTML, discovery, and caching
  llm/                    Ollama adapter, prompts, validation
  telegram/               authorization, parsing, keyboards, digest splitting
  observability/          validated shared run, source, feedback, and metric contracts
deploy/                    VPS/Tailscale/GHCR deployment configuration
```

## Production deployment

Production uses the shared image in GHCR, a private Compose network, a persistent PostgreSQL volume, pre-deploy backups, migrations, health-gated rollout, and application-image rollback. Ollama stays on the VPS host or another private machine. Runtime containers use read-only filesystems, so migrations run through the Prisma binary already packaged in the image instead of installing dependencies at startup.

The complete Tailscale OAuth, VPS SSH, known-hosts, GHCR, GitHub Environment, server credential-file, first-deploy, operations, backup, and troubleshooting instructions are in [deploy/README.md](deploy/README.md). The exact credential inventory is in [deploy/ENVIRONMENT.md](deploy/ENVIRONMENT.md); safe templates live under `deploy/presets` and in the two `deploy/github-*.example` files.

GitHub's `production` environment holds only deployment transport credentials (SSH, GHCR, and Tailscale). Application runtime credentials belong only in mode-`0600` files under `/opt/watcher/deploy/runtime`; they must never be committed.

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
