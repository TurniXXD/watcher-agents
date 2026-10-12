# MU Clubs Monitor

Internal monitor for public Masaryk University club activity. It discovers and normalizes relevant website and Instagram observations, classifies activities, persists source health, and publishes briefing events through its authenticated internal API.

Per-source due checks and shared Instagram caching keep polling bounded. Source failures are isolated and exposed through health/run results rather than converted into empty data.

## API and configuration

`GET /healthz` is unauthenticated. Other endpoints require `Authorization: Bearer $MU_CLUBS_API_TOKEN`.

Configure `DATABASE_URL`, `MU_CLUBS_API_TOKEN`, host/port, monitor and scheduler intervals, and Instagram cache/rate limits. See [the environment inventory](../../deploy/ENVIRONMENT.md).

## Development

```bash
pnpm --filter @watcher/mu-clubs-monitor typecheck
pnpm exec vitest run apps/mu-clubs-monitor/src/__tests__
```
