# Maintenance Agent

Private Telegram and HTTP operational agent for deterministic source health, run quality, deployment updates, and host/Ollama capacity monitoring.

It reads application health and persisted telemetry, evaluates stale/error conditions, and reports actionable recommendations. Host inspection uses read-only `/proc` and `/sys`; it does not require the Docker socket or privileged mode. Alerts use cooldowns and include a recovery message.

## Commands

Use `/status`, `/summary`, `/recommendations`, `/run`, `/debug`, `/updates`, `/about`, and `/help`.

## Configuration

Configure the database, `MAINTENANCE_TELEGRAM_TOKEN`, allowlist, API token, health/scheduler intervals, stale/error windows, resource thresholds, optional weekly analysis, changelog/release paths, and external Ollama URL. See [the maintenance preset](../../deploy/presets/maintenance-agent.env.example) and [environment inventory](../../deploy/ENVIRONMENT.md).

See [maintenance architecture](../../docs/maintenance-agent.md) and [the changelog](../../docs/maintenance-changelog.md).
