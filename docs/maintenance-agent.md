# Maintenance Agent

The maintenance agent evaluates the other Watcher services from one normalized telemetry model. It uses deterministic rules and robust rolling statistics first. It never applies recommendations.

## Architecture

`@watcher/observability` owns the validated `AgentRun`, source-run, feedback, metric-name, and recorder contracts. `AgentTelemetryStore` persists this contract. `LegacyTelemetryImporter` normalizes existing watcher, briefing, MU Clubs, and Brno Events run tables without storing large raw payloads. New services can write the same contract directly.

The maintenance engine calculates source health and stores deduplicated findings and recommendations. A finding fingerprint is stable for one agent, problem type, and scope. Repeated detection updates evidence and occurrence count instead of creating notification noise. Each evaluation resolves every deterministic scope it re-evaluates before reopening only the findings still supported by current evidence. Overlapping recurring-failure, stale-source, and source-degradation findings for the same agent and source produce one recommendation.

Security intelligence reuses the same finding, recommendation, scheduler,
outbox, logging, and API infrastructure. A GitHub Actions scanner runs the
pinned Trivy image without a Docker socket, scans read-only manifests plus an
immutable registry digest, and uploads successful JSON reports through the
existing Tailscale/SSH path. A VPS helper reads the Maintenance API token only
from the server runtime file and posts the report over loopback. Stable
fingerprints intentionally omit installed version so an upgrade updates the
same finding rather than creating noise.

The security pipeline has two explicit trust categories:

- Confirmed environment findings come from an actual Trivy target/package and
  installed version or a deterministic Trivy misconfiguration check.
- Technology-watch advisories come from structured OSV package coordinates or
  NVD CPEs. They are always marked as requiring deployed-version verification.
  Provider-managed Cloudflare/Vercel status incidents are not converted into
  patchable vulnerabilities.

Both categories preserve upstream identifiers, version evidence, source URLs,
and all available sourced CVSS vectors. CVE-bearing records are enriched from
FIRST EPSS and CISA KEV. Missing or failed enrichment remains unavailable rather
than becoming zero or “not exploited.” Independent watch sources use
`Promise.allSettled`; one outage does not cancel the other results. Advisory
text is stored as untrusted evidence and is never executed or treated as an
instruction.

## Detectors and baselines

Implemented detectors cover recurring agent/source failure, degraded sources, sources without a successful request relative to their own successful-request cadence, output-volume regressions, noisy downstream filtering, direct low-value feedback, producer-to-briefing usage mismatches, feedback-backed duplicate delivery and classification problems, latency regression, and LLM cost regression. A source returning zero items successfully is healthy; `duplicatesRemoved` records effective prevention and is not evidence that duplicate output reached a user. Briefing usage is attributed back to `stocks-bot`, `publications-bot`, `news-bot`, or `mu-clubs-monitor`; fewer than 10% selected out of at least 20 emitted events creates an evidence-backed finding. Baselines use medians, percentiles, and median absolute deviation helpers over the selected lookback window. P99 is reported only with at least 100 samples.

To add a detector, implement a pure function in `apps/maintenance-agent/src/evaluation/detectors.ts`, return a stable fingerprint plus evidence and a targeted proposal, add synthetic tests, and include it in `detectAll`.

## Feedback

Downstream consumers record `included`, `filtered`, `opened`, `ignored`, `dismissed`, `acted_on`, `marked_useful`, or `marked_not_useful`. Briefing feedback is imported. A sustained filtering/negative-feedback rate above 70% is evidence of noisy upstream output; feedback reasons mentioning reclassification provide classification-quality evidence.

## Scheduler

- Lightweight health: every 360 minutes by default, 24-hour lookback.
- Daily analysis: every 1440 minutes, 7-day lookback.
- Weekly trend analysis: every 10080 minutes, 30-day lookback.
- Startup jitter defaults to at most 300 seconds.
- Security technology watch runs with daily, weekly, and manual evaluations.
  Trivy's independent workflow defaults to hourly wakeups but skips unchanged
  lockfile hashes/image digests until its six-hour minimum interval expires.

The schedule is persisted through completed maintenance runs and cannot overlap within the process. Self-review is off by default. When enabled, the maintenance agent evaluates only its own failures, latency, and cost; it does not recursively evaluate the quality of its recommendation logic.

## Capacity alerts and run debugging

The runtime monitor samples CPU and memory every 30 seconds and sends an authorized Telegram warning after three consecutive samples at or above the configured threshold. CPU, memory, and GPU default to 90%; repeated warnings are limited to one every 30 minutes and a recovery message is sent after utilization drops at least ten percentage points below the threshold. Host `/proc` and `/sys` are mounted read-only into the maintenance container. Memory comes from host `MemTotal`/`MemAvailable`, avoiding container-runtime unit and availability inconsistencies, and each capacity warning includes the five largest relevant processes without reading process environments. GPU monitoring uses `nvidia-smi` when NVIDIA Container Toolkit exposes it or DRM sysfs for AMD/Intel/NVIDIA detection and available utilization/VRAM counters. Production deployment automatically applies the NVIDIA Compose overlay when both the host utility and Docker runtime are present. Unsupported counters are reported as unavailable rather than estimated. Ollama work remains serialized, but a normal or low-priority request waiting for 30 seconds ages into FIFO order so repeated briefing work cannot starve it. Queue-age warnings use at least the active request's declared timeout, avoiding false backlog alerts for expected long-running serialized inference.

`/debug` or `/debug on` persistently enables detailed reports for newly completed runs. `/debug off` disables them and `/debug status` shows the current server snapshot. Reports include duration, item/source counts, failures, process CPU time and average, peak RSS/heap, and a current server CPU/RAM/GPU snapshot. The debug subscription and delivery deduplication are stored in PostgreSQL, so restarts do not replay completed runs.

`/status` probes every other service's private Compose health endpoint on demand and combines that live result with its latest normalized run telemetry. It reports `RUNNING`, `DEGRADED`, `STALE`, `UNHEALTHY`, or `DOWN`, plus up to two deduplicated run/source errors from the configured lookback. Error text is truncated and URLs and credential-like values are redacted. The default stale threshold is 26 hours and the error lookback is 24 hours.

## API

`GET /health` is unauthenticated for container health checks. Every `/maintenance/*` route requires `Authorization: Bearer $MAINTENANCE_API_TOKEN`.

- `GET /maintenance/summary`
- `GET /maintenance/findings` and `GET /maintenance/findings/:id`
- `GET /maintenance/recommendations` and `GET /maintenance/recommendations/:id`
- `POST /maintenance/run`
- `POST /maintenance/security/trivy`
- `POST /maintenance/recommendations/:id/acknowledge`
- `POST /maintenance/recommendations/:id/reject`
- `GET /maintenance/briefing`

Acknowledgement changes a proposal to approved but does not apply it. There are intentionally no mutation, restart, deployment, source-disable, prompt-edit, or arbitrary shell endpoints.

The Trivy route accepts either `{project, service, scanKey, scannedAt, report}`
or a raw Trivy JSON body with the corresponding `X-Watcher-*` headers. It is
limited to 64 MiB while other Maintenance API routes retain the 10 MiB general
limit, and it uses the same bearer authentication as the other maintenance
routes. Normal production ingestion is performed only by the VPS helper; never
expose this listener publicly.

## AI observability

The eight Watcher processes using the shared Ollama provider initialize the
official OpenLIT Node SDK only when `OPENLIT_ENABLED=true`. The shared provider
adds content-free OpenTelemetry spans around raw `/api/chat` and `/api/embed`
calls, including provider, model, caller, optional correlation/job IDs, latency,
failure state, and provider-reported token counts. OpenLIT's Ollama auto-
instrumentor is disabled to prevent duplicate spans. Prompt/output capture is
forced off, cost is omitted because local Ollama pricing is not reliable, and
no credentials or request content are attached.

An external OTLP/OpenLIT endpoint is required when enabled, so a missing
collector cannot silently switch to console export. Sampling is configurable;
retention and any further metadata redaction belong to the operator-managed
backend. No OpenLIT service is added to Compose. Existing Maintenance detectors
remain the source of immediate repeated-failure, high-latency, and abnormal
usage recommendations from normalized run telemetry; OpenLIT supplies detailed
traces for diagnosis rather than duplicating those metrics in PostgreSQL.

## Security alert and report policy

Immediate alerts are limited to NEW or RESURFACED confirmed findings. Confirmed
CRITICAL and CISA KEV findings always alert; other findings must reach the
configured deterministic score. Daily reports separate confirmed findings from
watch-only advisories. Weekly reports show lifecycle counts, severity posture,
aging, and verified fix availability. Each immediate alert and scheduled report
uses a scan/advisory correlation key plus chat ID for durable deduplication.

## Telegram and code updates

The private Telegram bot supports `/about`, `/status`, `/summary`, `/run`, `/debug`, `/recommendations`, and `/updates` (help text). `/about` explains its operational-observer role, inputs, outputs, and non-mutating safety boundary. `/recommendations` returns at most eight proposals backed by currently open findings and includes their evidence summary; historical or recovered findings are omitted. Runtime changes must be appended to `docs/maintenance-changelog.md`. On startup, entries are announced once per authorized chat and deduplicated in PostgreSQL.

## Limitations

Historical watcher tables do not contain successful per-source request latency for every older stocks/publications/news run, so legacy source metrics are incomplete. The shared recorder supports these fields for direct producer integration. Item-level canonical URLs and semantic fingerprints are not yet part of the common telemetry model, so duplicate detection currently uses producer-supplied duplicate counts rather than attempting unreliable cross-agent matching. User engagement is only measurable when a consumer writes feedback. The deterministic engine does not invent replacement sources or cost estimates and does not require an LLM.

NVD technology watch uses a bounded seven-day modification window and preserves
advisories already stored rather than falsely resolving them when they leave the
window. A watch advisory is resolved only through later verified lifecycle work;
the Trivy confirmed scope can resolve automatically when a complete successful
scan no longer contains its fingerprint. OSV/NVD/EPSS/KEV availability is
external; failed sources are logged and retried by the next scheduled run.
