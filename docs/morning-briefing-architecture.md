# Personal Morning Briefing Bot — architecture and implementation plan

Status: phases 1–12 implemented and verified. This document records the resulting architecture and operational constraints.

## 1. Current Stocks architecture

`apps/stocks-bot` is a long-running grammY process. Its thin entry point wires `WatcherStore`, stock source adapters, `StockIntelligenceAnalyzer`, discovery, reconciliation, alert delivery, and a persistent interval scheduler. Source work is normalized to the shared `WatchItem` contract and processed through the shared runner/pipeline. Stock-only policy, intelligence, monitoring, and source code stay inside the app. PostgreSQL persists watchlists, source switches, observations, canonical stock events, theses, alerts, runs, discovery, and validation state.

## 2. Current Medical architecture

There is no separate application named Medical Bot. The existing `apps/publications-bot` is the medical/publication producer and must remain the deployed service name during incremental integration. It monitors publication queries through PubMed, bioRxiv, ClinicalTrials.gov, and openFDA adapters, then uses the same runner/pipeline and Ollama provider as Stocks. In the briefing contract it is registered as `medical`, mapped to the existing database/runtime kind `PUBLICATIONS`.

## 3. Current Telegram architecture

Each app owns its commands and callbacks. `packages/telegram` shares authorization, input parsing, HTML escaping, command copy, source/validation messages, digest rendering, progress-message editing, and message splitting. Every command is guarded by configured Telegram user IDs. The Briefing Bot is a third grammY process and owns briefing-specific onboarding and commands.

The News Watcher is a separate grammY process with one bot identity and two persisted editorial profiles, `CZECH` and `GLOBAL`. A hardcoded, automatically enabled catalog combines official RSS/Atom feeds with shared GDELT discovery adapters; operators can pause individual built-in sources and add optional custom feeds. Ranking topics remain scoped to their profile, while ingestion, deduplication, analysis, scheduling, and briefing publication are shared.

## 4. Current database architecture

`packages/database` owns Prisma/PostgreSQL and repository-style stores. Durable identity uses constraints for processed items, canonical stock events, alerts, configuration, schedules, and stock intelligence state. Briefing events use an independent integration table rather than overloading the stock-specific `CanonicalEvent`; settings, subscriptions, run windows, story state, encrypted Calendar credentials, delivery attempts, producer health, coverage, and run metrics are persisted separately.

## 5. Current scheduler/queue architecture

There is no Redis, BullMQ, external queue, host cron, or systemd timer. PostgreSQL-backed schedulers claim due work and prevent overlap. Independent source calls use `Promise.allSettled()`. Ollama and Piper work is serialized across processes with a PostgreSQL advisory resource lock. The Briefing Bot uses the same pattern without new infrastructure.

## 6. Current Ollama architecture

Ollama is an external system service, not a Compose service. `packages/llm` calls `/api/chat`, requests structured JSON, validates output with Zod, retries malformed output a bounded number of times, applies timeouts, and supports context/prediction/keep-alive configuration. Briefing script generation uses its own prompt/output contract and the same database-backed heavy-model lease.

## 7. Reusable components

- `packages/core`: validation utilities, watcher runner/pipeline, scheduling primitives, progress, logging, and now the briefing event contract/registry.
- `packages/database`: Prisma client, migrations, event repository, run claims, and the existing Ollama advisory lease.
- `packages/telegram`: authorization, safe formatting, splitting, and edit-in-place progress.
- `packages/llm`: Ollama transport, timeout/retry behavior, and Zod-validated boundaries.
- Deployment: one immutable Watcher image, separate long-running services, migration-before-rollout, private PostgreSQL, read-only containers, and runtime secret files.

The stock canonical-event code is not reusable as the cross-bot story model. It contains stock-only fields and relations.

## 8. Required Stocks Bot changes

The Stocks publisher runs after durable stock intelligence/event decisions. It maps only meaningful canonical changes to registered stock categories, uses canonical event identity for stable deduplication, and excludes price ticks, unchanged thesis snapshots, source duplicates, and ordinary fetched articles.

Producer publication must not make the stock run fail after its own durable result is saved. Failures are logged and exposed in health metrics for retry/reconciliation.

## 9. Required Medical Bot changes

The Publications Bot is the `medical` producer. It maps successfully analyzed, high-relevance research to medical categories, retains sourced evidence properties in JSON metadata, and uses publication source identity as its stable external ID. Low-relevance and duplicate publications are not emitted.

Renaming the deployed app/service is deliberately avoided; only the integration identity is `medical`.

## 10. Shared Briefing Event contract

The shared contract defines a strict Zod schema for `WatcherBotId`, timestamps, scores, URLs, JSON-safe metadata, entities, confidence, status, and registered per-producer categories. Scores are integer percentages from 0 through 100. Unknown fields, unknown watcher IDs, invalid URLs/timestamps, cross-producer categories, and non-JSON metadata are rejected. Ticker syntax is normalized at the producing boundary and must already be uppercase.

The registry includes `stocks`, `medical`, `news`, and `mu-clubs`. News maps to the `NEWS` runtime kind and owns `NEWS_*`; the standalone MU Clubs service owns `CLUB_*` events and reports producer health as `mu-clubs`. Every watcher addition requires an explicit schema, registry, migration, producer, and UI change.

## 11. Database migrations

Phase 1 adds `briefing_events` plus enums for watcher, confidence, and status. Primary ID and optional `(watcherBot, externalEventId)` and `(watcherBot, deduplicationKey)` uniqueness make producer retries idempotent. A database check enforces score ranges independently of TypeScript. Indexes support producer/time-window and status/time-window retrieval.

The repository validates before persistence, logs malformed input without logging the entire event, treats a newer delivery as an update of the canonical row, and refuses stale overwrites. Producer `createdAt` remains stable; `updatedAt` is producer-controlled. Identity collisions are errors rather than silently merging unrelated rows.

Later committed migrations add settings/subscriptions/location/onboarding, briefing runs, story clusters/members/state, encrypted Calendar credentials, delivery attempts, scheduling, producer health, coverage, and structured run metrics.

## 12. Onboarding state machine

Onboarding persists one state per Telegram chat rather than holding it in process memory. Implemented states are `LOCATION`, `VOICE`, `GOOGLE_CALENDAR`, `SUBSCRIPTIONS`, `BRIEFING_TIME`, and `COMPLETE`. Each transition validates a typed payload and can be resumed after restart; `/start` resumes incomplete onboarding and summarizes completed onboarding.

Callbacks carry short opaque actions, never secrets or full user payloads. Every callback is authorized again.

## 13. Location design

Store a user-facing label, latitude, longitude, IANA timezone, acquisition method (`TELEGRAM`, `GEOCODED_CITY`, or `MANUAL`), and update timestamp. Telegram live location is reduced to a point; continuous tracking is neither needed nor stored. City input is geocoded through an injectable provider with explicit user confirmation when ambiguous. Validate coordinate ranges and never treat location text as a URL.

Location is optional: the briefing can continue without weather and report a configuration hint.

## 14. Weather provider design

Define a small injectable provider returning normalized current conditions, useful daily range, precipitation risk/timing, wind, and severe alerts for coordinates/timezone. Keep provider response formats outside the briefing engine. Cache by rounded location and forecast period to avoid duplicate calls for concurrent manual/scheduled requests. Weather failure omits that section; it never blocks watcher stories.

The current provider is Open-Meteo behind injectable geocoding and forecast adapters. Its response is schema-validated and briefly cached by rounded location, timezone, and forecast period.

## 15. Google Calendar integration design

The Briefing Bot includes a narrow read-only Google Calendar client and encrypted per-chat refresh-token storage. OAuth uses a short-lived state-bound HTTP callback. The callback server derives its one accepted path from `GOOGLE_CALENDAR_REDIRECT_URI`; the recommended production path is `/briefing-bot/oauth/google/callback`, allowing multiple bots to share an API domain without sharing a callback route. Production should expose the loopback-bound Compose port only through a trusted HTTPS reverse proxy matching the registered redirect URI. Morning and afternoon briefings retrieve the current local day's events. Evening and night briefings recap the current local day and retrieve the next local day's events for the forward-looking section, including across daylight-saving transitions.

Refresh tokens never appear in Telegram, logs, or ordinary environment output and are encrypted with AES-256-GCM before persistence. The client requests only Calendar read-only scope, retrieves configured calendars for the local-day window, and excludes event descriptions from logs.

Calendar failure produces a short unavailable notice and does not block the rest of a briefing.

## 16. Watcher subscription design

Subscriptions are Briefing Bot preferences keyed by Telegram chat and `WatcherBotId`. They do not enable, disable, or schedule producer bots. The UI lists only the registry entries. The retrieval query filters briefing events using enabled subscriptions and the run window. Disabling a subscription preserves old story state so re-enabling does not replay the entire history.

`mu-clubs` is created idempotently for existing and new Briefing settings the next time they are loaded. Its producer publishes semantically classified activities rather than generic “new post” notices and uses the same durable event repository and watcher-health store as Stocks, Medical, and News.

## 17. Story clustering design

Phase 7 first groups exact identities/dedup keys, then clusters cross-bot events using shared source URLs, normalized entities/tickers, temporal proximity, category compatibility, and conservative semantic similarity. Normalized title, summary, and entities from every producer, including News, are embedded through Ollama and cached in the existing PostgreSQL `briefing_events` pgvector columns; an exact cosine search is restricted to plausible recent candidates. A similarity match can merge events only when a shared entity/ticker, compatible category, or explicit source relationship also supports it. Broad News profile/category tags alone are not deterministic duplicate evidence, so cross-publisher and cross-language News coverage relies on the same conservative semantic path. Deterministic evidence remains authoritative, and embedding failure falls back to deterministic clustering without failing the briefing. One stock catalyst and one medical trial may become one story while retaining both source events and provenance.

Story state tracks first/last seen, last briefed, prior summary hash, significance, and open/resolved status. `UNCHANGED` events update evidence but are suppressed unless context materially changed. Clusters must be inspectable; no destructive merge of source events.

## 18. Script generation design

Phase 8 builds a structured briefing plan before prose: greeting, local weather, calendar, preview, ranked stories, three watch items, and closing. Duration is a maximum, not a quota. Quiet mornings should be short. The prompt receives only normalized, selected facts with citations/provenance and prior story context; it must distinguish sourced facts from inference.

Generate a typed plan/sections first, validate it, then render spoken text and a concise text index. Enforce word/time budgets deterministically after validation. TTS normalization expands symbols and difficult abbreviations only in the spoken copy; the displayed facts and URLs remain unchanged.

## 19. Piper installation/integration design

The active upstream is [OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl), licensed GPL-3.0. Its current documented installation is `pip install piper-tts`. Voice discovery/download uses `python3 -m piper.download_voices`; synthesis can use `python3 -m piper -m <voice> -f output.wav -- 'text'`. The [current CLI documentation](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/CLI.md) warns that repeated CLI invocations reload the model and points repeated users to the web/Python APIs.

Watcher should pin a tested Piper version in the image or a dedicated build artifact, download models at build/provision time rather than at request time, validate their hashes/licenses, and use the [Python API](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/API_PYTHON.md) through a small bounded worker process. Do not add Piper as a network service unless measurement proves process reuse is necessary.

## 20. Verified Piper voice model IDs

The current [Piper voice catalog](https://huggingface.co/rhasspy/piper-voices/blob/main/voices.json) contains these exact medium-quality identifiers:

- `en_US-amy-medium`
- `en_US-hfc_female-medium`
- `en_US-hfc_male-medium`
- `cs_CZ-jirka-medium`

Each voice requires both its `.onnx` model and `.onnx.json` configuration, as documented in [Piper voice files](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/VOICES.md). The model card for each downloaded voice must be reviewed because voice-model licensing can differ from Piper's code license. Telegram aliases `amy`, `hfc_female`, and `hfc_male` map only to the English IDs. `cs_CZ-jirka-medium` is not a selectable briefing voice; it is selected automatically for Calendar event sentences detected as Czech.

## 21. Audio pipeline design

The audio pipeline splits text on section/sentence boundaries, labels Czech Calendar event sentences, synthesizes each bounded WAV chunk sequentially with either the selected English model or `cs_CZ-jirka-medium`, concatenates the mixed-language chunks through a private manifest, and converts once to OGG/Opus with `ffmpeg`. Spoken text is passed to Piper over stdin so it is absent from the process command line. Temporary files live under a per-run directory in `/tmp`, manifests have restrictive permissions, and the directory is removed on success/failure. Executables and paths use argument arrays rather than an interpolated shell command.

If streaming or concatenation proves unreliable, retain per-chunk hashes and restart only missing chunks. Enforce maximum text, audio duration, output size, and execution time.

## 22. Telegram delivery design

Phase 10 sends the voice note with explicit duration metadata, then sends the compact HTML index as a separate normal-width message, and optionally sends a split transcript according to settings. Delivery records distinguish voice-sent, index-sent, transcript-sent, text-fallback, and failed attempts. Telegram retries use bounded exponential backoff and respect retry-after. Stable per-channel delivery keys prevent duplicate morning messages after a crash.

If voice generation or upload fails, send the generated briefing text as a fallback. If an optional transcript fails after voice succeeds, retry only the missing transcript.

## 23. Failure/retry design

Independent weather, Calendar, producer retrieval, script, TTS, and Telegram stages record explicit outcomes. Source-side producer failures are not reinterpreted as “no news.” Network and rate-limit errors are retried with small bounded backoff; validation, authorization, identity collision, and permanent 4xx errors are not blindly retried.

Briefing runs use a PostgreSQL uniqueness/claim keyed by chat, trigger intent, and period. A crashed run may be reclaimed after a configured stale threshold. Manual runs never advance the successful scheduled window. Scheduled success advances `periodEnd`; partial text fallback counts as delivered only when delivery policy says so.

## 24. Privacy/security considerations

Calendar tokens and sensitive settings are encrypted at rest with a deployment key outside PostgreSQL. Logs use IDs and stage names, not calendar content, location details, raw events, bot tokens, or full secret URLs. All commands/callbacks require existing user authorization. Location and calendar data are never sent to producer bots.

External URLs displayed from events are validated HTTP(S); server-side fetches remain limited to owned provider adapters with SSRF controls. Piper and ffmpeg receive fixed executable paths and argument arrays. Generated artifacts have retention limits and restrictive permissions. Database roles stay least-privilege and PostgreSQL remains private to Compose.

## 25. Expected server resource usage

Phase 1 adds negligible runtime cost: indexed PostgreSQL rows and schema validation. Later baseline Briefing Bot overhead should be similar to the existing Node bots (roughly tens to low hundreds of MiB, to be measured). Four medium Piper models are about 63 MiB each on disk plus configuration, but loaded runtime memory and ONNX workspace must be benchmarked; only the active model for each sequential segment should be loaded.

A 15-minute mono 22.05 kHz 16-bit WAV is roughly 40 MB before intermediate chunks; Opus is much smaller depending on bitrate. Reserve bounded `/tmp` space and never hold the full PCM plus all chunks in JavaScript memory. Current observed Ollama load is the dominant server workload.

## 26. Expected Ollama usage

Producers keep their existing bounded analyses. A briefing adds one planning/script generation for selected events, not one generation per story. A 15-minute spoken script is approximately 1,800–2,200 English words, commonly several thousand output tokens; on the current local 8B setup this can take minutes. Actual tokens and duration must be recorded per run.

Reuse the PostgreSQL Ollama advisory lease. Briefing generation should have a lower scheduling priority than time-sensitive stock analysis and a maximum prompt/output budget. Do not run an unbounded morning script concurrently with producer analysis.

## 27. Expected TTS generation time

No trustworthy server-specific number can be promised without benchmarking the exact CPU, Piper version, voice, and text. The acceptance gate in Phase 9 is measured real-time factor (generation seconds divided by audio seconds), peak RSS, output size, and quality for all four installed models, including a mixed English/Czech Calendar sample. Schedule enough lead time for the measured p95 plus Telegram upload.

Use a separate PostgreSQL advisory resource lock for TTS. The briefing coordinator must not start TTS while the configured heavyweight Ollama lease is active if measurements show harmful contention. One TTS job at a time is sufficient for this single-server/single-operator scope; this is a database-backed concurrency control, not a new queue service.

## 28. Health, coverage, and observability

Each successful producer run updates one durable health row for its integration identity. A run with source, analysis, or Briefing-event publication failures is `DEGRADED`; a fatal run is `UNAVAILABLE`; a clean later run restores `HEALTHY`. During briefing generation, a missing health row or a last run older than 36 hours is treated as unavailable. This prevents an empty event window from being reported as a quiet day when a subscribed producer did not actually supply usable data.

`briefingDataCoverage` is the equally weighted percentage of enabled components only: each subscribed watcher plus weather and Calendar when those features are enabled. Healthy/available contributes 100%, degraded contributes 50%, and unavailable contributes 0%. Disabled weather, disabled Calendar, and unsubscribed watchers are excluded rather than penalized.

Every completed run stores structured JSON metrics next to indexed first-class run fields. Metrics include events retrieved/selected/omitted, cluster duplicate reduction, unchanged suppression, per-watcher selection and duplicate rates, weather/Calendar/event-retrieval/script/Piper/Telegram latency, failed delivery channels, selected voice, planned/maximum duration, word count, actual audio duration, watcher health, and data coverage. A producer emitting at least 20 events while fewer than 10% reach the final selected briefing is logged as a tuning signal; it does not silently disable that producer.

Operational inspection uses structured container logs and PostgreSQL run/health rows. Logs intentionally omit exact location, Calendar contents, OAuth credentials, Telegram chat identifiers, and full event/script content. OAuth secrets and tokens are additionally covered by logger redaction.

## 29. Implementation checklist

1. Phase 1 — shared contract, registry, event schema/repository, validation/idempotency tests.
2. Phase 2 — Stocks and Publications/Medical publishers plus failure isolation and producer tests.
3. Phase 3 — settings, subscriptions, location, onboarding, runs, story state migrations/repositories.
4. Phase 4 — authorized grammY Briefing Bot onboarding and commands.
5. Phase 5 — geocoding/weather provider and graceful omission.
6. Phase 6 — explicit Calendar OAuth bootstrap decision, encrypted token store, read-only retrieval.
7. Phase 7 — deterministic retrieval/clustering/ranking/continuity and suppression metrics.
8. Phase 8 — typed plan, bounded script, spoken normalization, hallucination/provenance tests.
9. Phase 9 — pinned Piper, verified models/licenses, chunked synthesis, ffmpeg, benchmark gate.
10. Phase 10 — idempotent voice/index/transcript delivery, retry, and fallback.
11. Phase 11 — timezone schedule, durable claims/windows, manual/test isolation.
12. Phase 12 — health, structured metrics/logging, cleanup, security and production verification.

Every phase must pass targeted tests and root format, lint, typecheck, test, and build gates before the next production rollout. Database phases also require schema validation and a PostgreSQL-backed integration run. Docker phases require Compose validation and a production image build.

### Critical evaluation

The event-contract approach is a good incremental boundary because it leaves producers independent and gives the briefing consumer durable, replayable input. A direct in-process event bus would be wrong across separate containers; adding Redis/BullMQ would be disproportionate. PostgreSQL constraints and advisory locks already solve the required durability and single-server concurrency.

The largest unresolved risks are not Phase 1 code: Google OAuth without a public web UI, voice-model redistribution licenses, long local Ollama latency, and CPU contention between Ollama and Piper. Those are explicit phase gates. Calendar and voice setup must not be presented as available until their real authentication, model, benchmark, and fallback paths pass end-to-end tests.
