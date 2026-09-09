# Maintenance Agent Project Updates

Each code update that changes runtime behavior must add a concise entry here. The maintenance bot announces each entry once per authorized Telegram chat; delivery state is persisted by content hash.

## 2026-09-09 — Unified maintenance observability

- Added the maintenance agent with deterministic health, quality, latency, cost, source, schedule, noise, classification, and duplication checks.
- Added a shared structured observability contract and normalized historical telemetry import for all current agents.
- Added evidence-backed findings, human-approved recommendations, authenticated API endpoints, periodic reports, and one-time Telegram project-update announcements.
- No recommendation can modify production code, configuration, schedules, sources, database schema, or deployments automatically.
