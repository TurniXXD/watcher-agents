# Maintenance Agent

Private Telegram and HTTP operational agent for deterministic source health, run quality, deployment updates, host/Ollama capacity monitoring, and security intelligence.

It reads application health and persisted telemetry, evaluates stale/error conditions, and reports actionable recommendations. Host inspection uses read-only `/proc` and `/sys`; it does not require the Docker socket or privileged mode. Alerts use cooldowns and include a recovery message.

Scheduled evaluations use a PostgreSQL advisory lease, so overlapping containers cannot run the same due interval concurrently. Daily and weekly Telegram reports are queued in the persistent outbox with a per-run, per-chat idempotency key and retried after transient delivery failures.

## Security intelligence

The agent accepts authenticated Trivy JSON from the separate least-privilege
scanner workflow. It normalizes Linux packages, npm dependencies, Go modules,
Rust crates, and supported Trivy misconfiguration results, then stores stable
finding fingerprints and NEW, PERSISTENT, RESURFACED, or RESOLVED lifecycle
state in the existing maintenance tables. Actual scanned packages are reported
as **confirmed environment findings**. OSV package matches and NVD CPE matches
are stored separately as **technology-watch advisories** that require deployed
version verification. CISA KEV and FIRST EPSS enrich CVE-bearing records without
inventing unavailable values.

The built-in watchlist covers Linux/kernel, Docker Engine, containerd, Compose,
nginx, Git, Node.js/npm, TypeScript, Next.js, Go, and Rust. Cloudflare and Vercel
managed-platform status entries are deliberately excluded from patchable
vulnerability matching; deployable Next.js remains an OSV package entry. Replace
the default with `MAINTENANCE_TECHNOLOGY_WATCHLIST_JSON` when exact local package
versions or different CPEs are known. Keyword-only matching is rejected.

New/resurfaced confirmed CISA KEV or CRITICAL findings alert immediately.
Other confirmed findings use `MAINTENANCE_SECURITY_ALERT_MIN_SCORE`, combining
confirmed impact, exploitation evidence, EPSS, sourced CVSS, exposure/business
context when known, and verified fix availability. Technology-watch advisories
never trigger a confirmed-impact alert. Daily and weekly security reports reuse
the scheduler, persistent Telegram outbox, and delivery deduplication.

## Commands

Use `/start`, `/status`, `/summary`, `/recommendations`, `/run`, `/debug`, `/updates`, `/about`, and `/help`. `/help` shows the current complete command list.

## Configuration

Configure the database, `MAINTENANCE_TELEGRAM_TOKEN`, allowlist, API token, health/scheduler intervals, stale/error windows, resource thresholds, optional weekly analysis, security intelligence/watchlist settings, changelog/release paths, and external Ollama URL. See [the maintenance preset](../../deploy/presets/maintenance-agent.env.example) and [environment inventory](../../deploy/ENVIRONMENT.md).

See [maintenance architecture](../../docs/maintenance-agent.md) and [the changelog](../../docs/maintenance-changelog.md).

Source freshness tracks successful requests relative to each source's own
successful-request cadence. Successful empty responses are healthy.
`duplicatesRemoved` means duplicate work was prevented before delivery; the
duplicate-output detector requires direct feedback that repeated content
actually reached a user. Findings that are no longer supported are resolved on
the next evaluation.
