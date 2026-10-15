# Maintenance Agent

Private Telegram and HTTP operational agent for deterministic source health, run quality, deployment updates, and host/Ollama capacity monitoring.

It reads application health and persisted telemetry, evaluates stale/error conditions, and reports actionable recommendations. Host inspection uses read-only `/proc` and `/sys`; it does not require the Docker socket or privileged mode. Alerts use cooldowns and include a recovery message.

Scheduled evaluations use a PostgreSQL advisory lease, so overlapping containers cannot run the same due interval concurrently. Daily and weekly Telegram reports are queued in the persistent outbox with a per-run, per-chat idempotency key and retried after transient delivery failures.

## Commands

Use `/start`, `/status`, `/summary`, `/recommendations`, `/run`, `/debug`, `/updates`, `/about`, and `/help`. `/help` shows the current complete command list.

## Configuration

Configure the database, `MAINTENANCE_TELEGRAM_TOKEN`, allowlist, API token, health/scheduler intervals, stale/error windows, resource thresholds, optional weekly analysis, changelog/release paths, and external Ollama URL. See [the maintenance preset](../../deploy/presets/maintenance-agent.env.example) and [environment inventory](../../deploy/ENVIRONMENT.md).

See [maintenance architecture](../../docs/maintenance-agent.md) and [the changelog](../../docs/maintenance-changelog.md).

Source freshness tracks successful requests relative to each source's own
successful-request cadence. Successful empty responses are healthy.
`duplicatesRemoved` means duplicate work was prevented before delivery; the
duplicate-output detector requires direct feedback that repeated content
actually reached a user. Findings that are no longer supported are resolved on
the next evaluation.
