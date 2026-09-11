# Maintenance Agent Project Updates

Each code update that changes runtime behavior must add a concise entry here. The maintenance bot announces each entry once per authorized Telegram chat; delivery state is persisted by content hash.

## 2026-09-09 — Unified maintenance observability

- Added the maintenance agent with deterministic health, quality, latency, cost, source, schedule, noise, classification, and duplication checks.
- Added a shared structured observability contract and normalized historical telemetry import for all current agents.
- Added evidence-backed findings, human-approved recommendations, authenticated API endpoints, periodic reports, and one-time Telegram project-update announcements.
- No recommendation can modify production code, configuration, schedules, sources, database schema, or deployments automatically.

## 2026-09-09 — Maintenance signal accuracy

- Added explicit low-value feedback and producer-to-briefing usage mismatch findings.
- Added output-volume regression detection against each agent's own historical baseline.
- Corrected watcher duplicate telemetry so processing limits and previously stored items are not mislabeled as duplicates.
- Restricted optional self-review to maintenance failures, latency, and cost, and made scheduler shutdown cancel its pending jitter timer.
- Preserved original source-run timestamps during historical telemetry refreshes and made failed changelog announcements retryable.
- Added recent concrete source errors to recurring-failure evidence.

## 2026-09-11 — Fair publication topic selection and bioRxiv recovery

- Publication analysis limits now select candidates round-robin across topics instead of allowing the alphabetically first query to monopolize a run.
- Newest papers are preferred within each topic and topic order rotates deterministically per run.
- Empty, malformed, or truncated JSON receives one bounded retry, fixing transient bioRxiv `Unexpected end of JSON input` failures.
- Telegram digests group a shared provider failure across all affected queries instead of repeating the same error hundreds of times.

## 2026-09-10 — Server capacity alerts and debug run reports

- Added sustained CPU, memory, GPU, and VRAM capacity warnings with cooldown and recovery notifications.
- Added persistent `/debug on|off|status` controls and deduplicated Telegram reports for newly completed bot runs.
- Added per-run process CPU time, average CPU use, peak RSS, and peak heap telemetry to Stocks, Publications, News, MU Clubs, Brno Events, and Briefing runs.
- GPU readings use NVIDIA or AMD host interfaces when exposed and are clearly marked unavailable otherwise.
