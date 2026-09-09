# Maintenance Agent

The maintenance agent evaluates the other Watcher services from one normalized telemetry model. It uses deterministic rules and robust rolling statistics first. It never applies recommendations.

## Architecture

`@watcher/observability` owns the validated `AgentRun`, source-run, feedback, metric-name, and recorder contracts. `AgentTelemetryStore` persists this contract. `LegacyTelemetryImporter` normalizes existing watcher, briefing, MU Clubs, and Brno Events run tables without storing large raw payloads. New services can write the same contract directly.

The maintenance engine calculates source health and stores deduplicated findings and recommendations. A finding fingerprint is stable for one agent, problem type, and scope. Repeated detection updates evidence and occurrence count instead of creating notification noise.

## Detectors and baselines

Implemented detectors cover recurring agent/source failure, degraded sources, stale sources relative to their own publishing cadence, noisy or low-value downstream output, duplicate rate, feedback-backed classification problems, latency regression, LLM cost regression, and excessive polling. Baselines use medians, percentiles, and median absolute deviation helpers over the selected lookback window. P99 is reported only with at least 100 samples.

To add a detector, implement a pure function in `apps/maintenance-agent/src/evaluation/detectors.ts`, return a stable fingerprint plus evidence and a targeted proposal, add synthetic tests, and include it in `detectAll`.

## Feedback

Downstream consumers record `included`, `filtered`, `opened`, `ignored`, `dismissed`, `acted_on`, `marked_useful`, or `marked_not_useful`. Briefing feedback is imported. A sustained filtering/negative-feedback rate above 70% is evidence of noisy upstream output; feedback reasons mentioning reclassification provide classification-quality evidence.

## Scheduler

- Lightweight health: every 360 minutes by default, 24-hour lookback.
- Daily analysis: every 1440 minutes, 7-day lookback.
- Weekly trend analysis: every 10080 minutes, 30-day lookback.
- Startup jitter defaults to at most 300 seconds.

The schedule is persisted through completed maintenance runs and cannot overlap within the process. Self-review is off by default and excludes the maintenance agent from analysis.

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

The private Telegram bot supports `/summary`, `/run`, `/recommendations`, and `/updates` (help text). Runtime changes must be appended to `docs/maintenance-changelog.md`. On startup, entries are announced once per authorized chat and deduplicated in PostgreSQL.

## Limitations

Historical watcher tables do not contain successful per-source request latency for every older stocks/publications/news run, so legacy source metrics are incomplete. The shared recorder supports these fields for direct producer integration. User engagement is only measurable when a consumer writes feedback. The deterministic engine does not invent replacement sources or cost estimates and does not require an LLM.
