# Maintenance Agent

The maintenance agent evaluates the other Watcher services from one normalized telemetry model. It uses deterministic rules and robust rolling statistics first. It never applies recommendations.

## Architecture

`@watcher/observability` owns the validated `AgentRun`, source-run, feedback, metric-name, and recorder contracts. `AgentTelemetryStore` persists this contract. `LegacyTelemetryImporter` normalizes existing watcher, briefing, MU Clubs, and Brno Events run tables without storing large raw payloads. New services can write the same contract directly.

The maintenance engine calculates source health and stores deduplicated findings and recommendations. A finding fingerprint is stable for one agent, problem type, and scope. Repeated detection updates evidence and occurrence count instead of creating notification noise.

## Detectors and baselines

Implemented detectors cover recurring agent/source failure, degraded sources, stale sources relative to their own publishing cadence, output-volume regressions, noisy downstream filtering, direct low-value feedback, producer-to-briefing usage mismatches, duplicate rate, feedback-backed classification problems, latency regression, LLM cost regression, and excessive polling. Briefing usage is attributed back to `stocks-bot`, `publications-bot`, `news-bot`, or `mu-clubs-monitor`; fewer than 10% selected out of at least 20 emitted events creates an evidence-backed finding. Baselines use medians, percentiles, and median absolute deviation helpers over the selected lookback window. P99 is reported only with at least 100 samples.

To add a detector, implement a pure function in `apps/maintenance-agent/src/evaluation/detectors.ts`, return a stable fingerprint plus evidence and a targeted proposal, add synthetic tests, and include it in `detectAll`.

## Feedback

Downstream consumers record `included`, `filtered`, `opened`, `ignored`, `dismissed`, `acted_on`, `marked_useful`, or `marked_not_useful`. Briefing feedback is imported. A sustained filtering/negative-feedback rate above 70% is evidence of noisy upstream output; feedback reasons mentioning reclassification provide classification-quality evidence.

## Scheduler

- Lightweight health: every 360 minutes by default, 24-hour lookback.
- Daily analysis: every 1440 minutes, 7-day lookback.
- Weekly trend analysis: every 10080 minutes, 30-day lookback.
- Startup jitter defaults to at most 300 seconds.

The schedule is persisted through completed maintenance runs and cannot overlap within the process. Self-review is off by default. When enabled, the maintenance agent evaluates only its own failures, latency, and cost; it does not recursively evaluate the quality of its recommendation logic.

## Capacity alerts and run debugging

The runtime monitor samples CPU and memory every 30 seconds and sends an authorized Telegram warning after three consecutive samples at or above the configured threshold. CPU, memory, and GPU default to 90%; repeated warnings are limited to one every 30 minutes and a recovery message is sent after utilization drops at least ten percentage points below the threshold. Host `/proc` and `/sys` are mounted read-only into the maintenance container. Memory comes from host `MemTotal`/`MemAvailable`, avoiding container-runtime unit and availability inconsistencies, and each capacity warning includes the five largest relevant processes without reading process environments. GPU monitoring uses `nvidia-smi` when NVIDIA Container Toolkit exposes it or DRM sysfs for AMD/Intel/NVIDIA detection and available utilization/VRAM counters. Production deployment automatically applies the NVIDIA Compose overlay when both the host utility and Docker runtime are present. Unsupported counters are reported as unavailable rather than estimated.

`/debug` or `/debug on` persistently enables detailed reports for newly completed runs. `/debug off` disables them and `/debug status` shows the current server snapshot. Reports include duration, item/source counts, failures, process CPU time and average, peak RSS/heap, and a current server CPU/RAM/GPU snapshot. The debug subscription and delivery deduplication are stored in PostgreSQL, so restarts do not replay completed runs.

`/status` probes every other service's private Compose health endpoint on demand and combines that live result with its latest normalized run telemetry. It reports `RUNNING`, `DEGRADED`, `STALE`, `UNHEALTHY`, or `DOWN`, plus up to two deduplicated run/source errors from the configured lookback. Error text is truncated and URLs and credential-like values are redacted. The default stale threshold is 26 hours and the error lookback is 24 hours.

## API

`GET /health` is unauthenticated for container health checks. Every `/maintenance/*` route requires `Authorization: Bearer $MAINTENANCE_API_TOKEN`.

- `GET /maintenance/summary`
- `GET /maintenance/findings` and `GET /maintenance/findings/:id`
- `GET /maintenance/recommendations` and `GET /maintenance/recommendations/:id`
- `POST /maintenance/run`
- `POST /maintenance/recommendations/:id/acknowledge`
- `POST /maintenance/recommendations/:id/reject`
- `GET /maintenance/briefing`

Acknowledgement changes a proposal to approved but does not apply it. There are intentionally no mutation, restart, deployment, source-disable, prompt-edit, or arbitrary shell endpoints.

## Telegram and code updates

The private Telegram bot supports `/about`, `/status`, `/summary`, `/run`, `/debug`, `/recommendations`, and `/updates` (help text). `/about` explains its operational-observer role, inputs, outputs, and non-mutating safety boundary. Runtime changes must be appended to `docs/maintenance-changelog.md`. On startup, entries are announced once per authorized chat and deduplicated in PostgreSQL.

## Limitations

Historical watcher tables do not contain successful per-source request latency for every older stocks/publications/news run, so legacy source metrics are incomplete. The shared recorder supports these fields for direct producer integration. Item-level canonical URLs and semantic fingerprints are not yet part of the common telemetry model, so duplicate detection currently uses producer-supplied duplicate counts rather than attempting unreliable cross-agent matching. User engagement is only measurable when a consumer writes feedback. The deterministic engine does not invent replacement sources or cost estimates and does not require an LLM.
