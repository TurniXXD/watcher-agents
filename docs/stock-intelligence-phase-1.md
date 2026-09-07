# Stock Intelligence Engine: architecture and Phase 1

This document evaluates the master specification against the existing Watcher repository and records the Phase 1 implementation boundary. It is intentionally explicit about incomplete capabilities. No output described here should be interpreted as investment advice or an automated trading instruction.

## 1. Current architecture

Watcher is a TypeScript Turborepo with two independent grammY bot processes. Both use PostgreSQL through Prisma, a shared `WatcherPipeline`, injectable source adapters, and one external Ollama service. Runs are triggered manually or by a persisted cron schedule. Independent source requests run concurrently through `Promise.allSettled`; analysis is serialized and globally protected by a PostgreSQL advisory lock.

The stock bot previously modeled a stock as a ticker plus enabled source switches. Source results were normalized only to `WatchItem`, deduplicated by `(watcherKind, source, externalId)`, and stored as `ProcessedItem`. The system did not have an explicit company lifecycle, monitoring resolution, observation timestamps beyond publication/first-seen time, or domain-event journal.

## 2. Reusable components

- `packages/core`: cross-bot source contract, normalized `WatchItem`, deduplication, partial-failure pipeline, run guard, persistent cron scheduler, progress reporting, and structured logging.
- `packages/database`: transaction boundaries, overlap claim, durable run state, item identity constraints, cross-user analysis reuse, source configuration, and Ollama advisory lock.
- `apps/stocks-bot/core`: stock-only universe, monitoring, event intelligence, and discovery behavior.
- `apps/stocks-bot/sources`: SEC EDGAR, Stooq, FINVIZ, Zacks, Earnings Whispers, and reusable RSS/Atom parsing.
- `packages/llm`: bounded Ollama calls, JSON output, Zod validation, and retry behavior.
- `packages/telegram`: private authorization, command parsing, progress-message editing, digest formatting, and message splitting.
- Deployment: one immutable application image, two bot services, one private PostgreSQL service, external Ollama, migrations before rollout, and backups.

## 3. Relevant technical debt

- A whole watcher currently has one cron expression. Per-source adaptive intervals are modeled but not yet executed.
- `ProcessedItem` combines raw observation identity and analysis input. Phase 1 extends it without renaming it to preserve backward compatibility; a later migration may split immutable raw payloads from canonical events.
- Source deduplication is exact within one provider. Cross-provider semantic/event deduplication belongs to Phase 2.
- FINVIZ, Zacks, Earnings Whispers, Stooq, and GDELT endpoints do not provide the same stability, licensing clarity, or SLA as contracted APIs.
- GDELT article-list results provide discovery metadata and headlines, not licensed full article text.
- IR feed discovery depends on issuer metadata and an advertised RSS/Atom feed. Many issuers expose neither.
- The current LLM schema summarizes each observation independently; it does not yet compare a new event with persistent thesis state.
- Source health, exponential backoff, data coverage, cooldowns, and event materiality are Phase 2 concerns.

## 4. Target architecture

The long-term architecture should remain a modular monolith with two processes, not a distributed system:

```text
Telegram / scheduler
        |
Universe + monitoring policy
        |
Source adapters -> normalized observations -> PostgreSQL identity constraint
        |                                      |
        |                                      +-> append-only domain-event journal
        v
Phase 2 event extraction -> canonical events/chains -> materiality gate
        |
targeted analysis -> optional full analysis -> company thesis state -> alert
```

The event journal is durable. The in-process event bus is for same-process subscribers only. PostgreSQL remains the recovery boundary; no Redis, broker, queue service, host cron, or additional daemon is required.

## 5. Database schema

Phase 1 extends `Stock` as the company-universe record:

- identity: `symbol`, `companyName`, `cik`
- reference data: `exchange`, `sector`, `industry`, `marketCap`, `currency`, `country`, `investorRelationsUrl`
- lifecycle: `enabled`, `monitoringTier`, `monitoringMode`, `priority`, `tags`, `watchReason`, `watchUntil`

`ProcessedItem` remains the unique raw-observation record and now stores:

- `ticker`, `source`, `sourceType`, `sourceUrl`, `primarySource`
- `publishedAt`, `discoveredAt`, `eventAt`
- `category`, `headline`, `rawText`, `normalizedFacts`, `entities`, `reliability`, `metadata`

`DomainEvent` is an append-only journal with `type`, aggregate identity, occurrence time, and JSON payload. The migration only adds nullable/defaulted columns and tables, so the previous application image can still run after the migration.

## 6. Event-bus design

`InProcessEventBus` validates events, optionally appends them through an `EventJournal`, and waits for all matching subscribers. It is not a network broker. Critical observation/company events are inserted transactionally by the database repository so a process crash cannot leave a database mutation without its durable journal record. Phase 2 can consume the journal idempotently using event IDs and checkpoints.

## 7. Watcher interfaces

Every adapter continues to implement `Source<TConfig>.fetch()` and may expose `SourceCapabilities`:

```ts
type SourceCapabilities = {
  sourceName: string;
  sourceType: string;
  minimumIntervalMs: number;
  preferredIntervalMs: number;
  maximumIntervalMs: number;
  supportsStreaming: boolean;
  costPerRequestUsd: number;
  rateLimitPerMinute: number | null;
  priority: number;
};
```

HTTP clients remain injectable. External JSON/XML is validated or parsed at the adapter boundary, then mapped to `WatchItem`. The persistence boundary converts it to a validated `NormalizedObservation`.

## 8. Scheduler design

The existing `PersistentScheduler` remains responsible for crash-safe watcher cron execution. Phase 1 adds a pure `effectiveSourceIntervalMs` policy and a `MonitoringScheduleRepository` contract. The policy combines source limits with tier, mode, market session, catalyst proximity, and attention, then clamps the result to provider bounds.

Phase 3 adds persisted stock-level high-resolution due times and executes the fast SEC/IR/news/price subset while a company is temporarily escalated. General per-source `lastCheckedAt`/`nextCheckAt` schedules and market-session-aware intervals remain future work.

## 9. Normalized observation and event schemas

`NormalizedObservation` is implemented and runtime-validated. It keeps publication time separate from system discovery time and supports a distinct event time. Missing facts remain absent rather than being invented.

Canonical investment `Event` extraction is deliberately not implemented in Phase 1. Phase 2 should add the specification's event type, direction, magnitude, surprise, materiality, primary evidence, related observations, and primary-driver fields, with a unique event fingerprint.

## 10. Company state machine

Tiers are `CORE`, `WATCH`, `DISCOVERY`, and `INVESTIGATE`. Modes are `LOW_RESOLUTION`, `NORMAL`, `HIGH_RESOLUTION`, and `EVENT_MODE`. Automated tier transitions are restricted to the documented lifecycle. Manual operator transitions are allowed as explicit overrides. Newly manually-added stocks default to `WATCH`/`NORMAL`, priority 50.

The Telegram commands `/set_tier`, `/set_mode`, `/set_priority`, `/stock_on`, and `/stock_off` expose Phase 1 state without adding a web UI.

## 11. Discovery to investigate to watch flow

Phase 1 supplied the states and transition validation. Phase 3 now implements the trigger and automatic movement:

```text
DISCOVERY --cheap anomaly--> INVESTIGATE + HIGH_RESOLUTION
INVESTIGATE --material evidence--> WATCH or EVENT_MODE
INVESTIGATE --timeout/no evidence--> DISCOVERY
WATCH --expired reason--> reevaluate -> WATCH or DISCOVERY
```

The implementation and operational limits are documented in `stock-intelligence-phase-3.md`.

## 12. Source deduplication strategy

Phase 1 keeps exact provider identity as the first gate and stores a content hash. This prevents repeated processing of the same provider item and allows successful analysis reuse across Telegram users. Phase 2 should create a canonical event fingerprint from ticker, event type, entities, primary identifiers, and a time window, then use semantic similarity only as a secondary check. SEC accession/transaction IDs should outrank URLs and headlines. Multiple observations may reference one event, but signal contribution must occur once.

## 13. Required external providers and APIs

Phase 1 uses SEC EDGAR, issuer RSS/Atom when discoverable, GDELT DOC 2.0, Stooq, FINVIZ, Zacks, and Earnings Whispers. Broad production coverage still needs contracted providers for reliable real-time market data and licensed news. Options, short interest, institutional data, and Quiver are later phases.

Recommended provider classes before broad or commercial deployment:

- official SEC/agency APIs for filings and regulatory facts;
- issuer-owned feeds or a contracted IR/newswire feed for company releases;
- a licensed market-data WebSocket/REST provider for trades, quotes, extended hours, and corporate actions;
- a licensed news provider for redistribution and reliable latency;
- a licensed options provider when Phase 8 begins.

## 14. Free versus paid providers

Provider terms and prices change and must be rechecked before purchase or production use.

| Provider                                    | Current role                           | Cost class                                 | Production caveat                                                                         |
| ------------------------------------------- | -------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| SEC EDGAR                                   | filings and company metadata           | free, no API key                           | identify the client and obey fair-access limits                                           |
| Issuer RSS/Atom                             | official releases when exposed         | usually free                               | coverage and format vary by issuer                                                        |
| GDELT DOC 2.0                               | basic news discovery                   | free public endpoint                       | no guaranteed full text, finance-specific coverage, or SLA                                |
| Stooq                                       | daily price snapshot                   | free public endpoint                       | licensing/automation terms and intraday coverage require confirmation                     |
| FINVIZ/Zacks/Earnings Whispers public pages | secondary snapshots                    | no direct API charge                       | undocumented endpoints/HTML; fragile and unsuitable for assumed high-frequency rights     |
| Quiver API                                  | later alternative data                 | paid; advertised from about USD 30/month   | API key and license review required; redistribution/commercial use is restricted by terms |
| NewsAPI                                     | possible licensed news index           | free only for development; production paid | current business pricing is materially higher than this self-hosted MVP                   |
| Massive or equivalent                       | later real-time/historical market data | limited free tier, paid real-time tiers    | exchange agreements and redistribution restrictions apply                                 |
| Reuters/LSEG                                | premium news                           | enterprise contract                        | do not scrape Reuters pages as a substitute for a license                                 |

## 15. Rate-limit considerations

- SEC requests use an identifying user agent and pacing. The deployment must remain below SEC fair-access guidance and react to 429/503 responses.
- NCBI without an API key should stay at or below its documented default request rate; batching IDs is preferred.
- Unknown public-page limits are treated as strict reasons not to poll those sources every minute.
- The adaptive policy never schedules below an adapter's minimum interval, but persisted backoff and provider-wide token buckets are Phase 2.
- A provider-wide limiter is required before scaling beyond a small watchlist because per-company concurrency can otherwise create bursts.

## 16. Licensing and terms-of-service concerns

Public accessibility is not the same as permission for automated collection, storage, derivative analysis, or redistribution. Before production scale, review the current terms for FINVIZ, Zacks, Earnings Whispers, Stooq, GDELT, and every news publisher. Store only the content needed for private research and retain source attribution. Do not redistribute Quiver data; its published terms describe the data as proprietary and restrict commercial use without authorization. Reuters must be accessed through a licensed channel.

## 17. Near-real-time capabilities

SEC submissions are updated throughout the day and can support low-minute polling within fair-access constraints. Issuer feeds and GDELT can be polled but have variable source latency. Stooq and the current analyst/public-page adapters do not provide a dependable low-latency market feed. The current deployed runner is daily by default; Phase 1 does not claim real-time operation merely because the interval policy exists.

## 18. Quiver integration plan

Quiver belongs in Phase 4 as an optional API-key adapter package, not Phase 1. Each dataset should map to a normalized observation category. The adapter must preserve Quiver publication/disclosure time and resolve SEC/USASpending/USPTO/13F primary records when possible. Canonical event deduplication must prevent Quiver and the primary source from creating two signals. Configuration should use an environment API key and explicit dataset switches; no key should be stored through Telegram.

## 19. Expected API request volume

With all Phase 1 stock sources enabled, a steady full run uses approximately per stock:

- SEC: one submissions request plus up to five filing-document requests;
- IR: one feed request after one-time process-local discovery, when a feed exists;
- GDELT, Stooq, FINVIZ, and Zacks: one request each;
- Earnings Whispers: three requests.

That is roughly 13–14 HTTP requests per stock per full run, plus initial metadata/discovery requests. Ten stocks once daily are roughly 130–140 requests/day. Ten stocks every five minutes would exceed 40,000 requests/day and is inappropriate for the current public-page sources. Phase 2 must schedule each source separately and add provider-wide limiting before low-minute operation.

## 20. Expected LLM volume

The current pipeline performs one Ollama call per newly reserved observation unless a successful cross-watcher analysis is reusable. Exact duplicates create no new call. With `OLLAMA_MAX_ITEMS_PER_RUN=0`, the upper bound is every new observation; a first run can therefore be large. Phase 2's materiality gate should reduce this to targeted calls only for medium-or-higher events, followed by full analysis only when thesis comparison requires it.

Ollama has no per-token API fee when self-hosted, but GPU/CPU time, power, latency, and contention are real costs. At six minutes per call, ten new items serialize to about one hour. Operators should cap initial backfills or run them overnight.

## 21. Cost-control strategy

1. Provider identity and database constraints before model work.
2. Cache source metadata and successful analysis safely.
3. Cheap deterministic parsing and event fingerprints.
4. Phase 2 materiality gate before targeted LLM analysis.
5. Full thesis analysis only after a material change.
6. Per-provider budgets, backoff, and source-specific schedules.
7. Bounded model context/output and one global Ollama lease.

## 22. Deployment architecture

Deployment remains unchanged: two non-root, read-only bot containers; one private PostgreSQL container; one migration job; and Ollama outside Compose. Both app processes can consume the same schema and journal. The migration is additive so image rollback remains possible. No dashboard/API service is added because Telegram is the repository's only UI.

## 23. Observability plan

Phase 1 already emits structured run/source/analysis logs and stores run/source failures. New durable fields provide publication and detection timestamps. Phase 2 should add source-health records, consecutive failures, backoff-until, last-success time, per-stage latency, duplicate counters, and event-processing checkpoints. LLM request duration and outcome should be logged without prompts or secrets. Host-level CPU/RAM/GPU and Ollama metrics remain external operational telemetry.

## 24. Implementation checklist

- [x] Preserve existing two-bot modular-monolith deployment.
- [x] Add company tiers, modes, lifecycle fields, priority, reason, and expiry.
- [x] Add runtime-validated normalized observation model.
- [x] Persist raw observation facts, source provenance, and separate timestamps.
- [x] Add append-only domain-event journal.
- [x] Add typed in-process event bus.
- [x] Add source capability metadata and adaptive interval policy.
- [x] Keep SEC and price watchers operational.
- [x] Add hardcoded GDELT basic-news discovery.
- [x] Add safe issuer-feed autodiscovery from SEC company metadata.
- [x] Expose universe configuration through Telegram.
- [x] Add unit and PostgreSQL integration coverage.
- [x] Persist and execute temporary high-resolution discovery schedules (Phase 3); general per-source scheduling remains future work.
- [x] Canonical event extraction, cross-source deduplication, materiality, and health/backoff (Phase 2).
- [x] Market-wide discovery and automatic promotion/demotion (Phase 3).
- [x] Quiver and specialized signals (Phase 4); advanced options and institutional datasets remain Phase 8.
- [x] Targeted analysis, signal scoring, data coverage, and persistent thesis state (Phase 5).
- [x] Scenarios, probability ranges, expected value, priced-in analysis, recommendations, and bounded sizing (Phase 6).
- [x] Live alerts, daily reconciliation, Telegram dashboards, and application observability (Phase 7).
- [ ] Advanced data, replay, calibration, and backtests (Phase 8+).
