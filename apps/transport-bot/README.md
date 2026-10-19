# Transport Bot

Private Telegram decision engine for a single van operator. It normalizes a configured request feed, rejects loads that cannot be proven to fit, routes viable candidates through an OSRM-compatible service, and ranks only opportunities satisfying persisted profit, profit/hour, empty-distance, detour, and confidence thresholds.

Manual search and proactive discovery share the same evaluator. Planned-trip recommendations charge only incremental distance and time. Unknown cargo dimensions or weight are never treated as compatible. The MVP never bids, accepts jobs, or contacts customers.

## Commands

Use `/start` to initialize the bot and begin vehicle setup when required. `/help` shows the current guide without changing setup or conversation state. `/about` explains the decision model, provider data, and safety boundaries without changing onboarding. Vehicle, cost, preference, immediate search, planned-trip, and return-load actions are available from the Telegram keyboard.

## Data and configuration

`TRANSPORT_REQUEST_FEED_URL` returns an array or `{ "requests": [...] }` of normalized requests. Missing values must be omitted. An optional bearer token is supported. Configure a production-grade `TRANSPORT_OSRM_URL`; the public project service is development-only. Fuel uses the European Commission bulletin converted with the CNB daily rate unless overridden.

Set `DATABASE_URL`, `TRANSPORT_TELEGRAM_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS`, feed/routing URLs, provider URLs, discovery interval, and health port. See [the environment inventory](../../deploy/ENVIRONMENT.md).

## Development

```bash
pnpm --filter @watcher/transport-bot typecheck
pnpm exec vitest run apps/transport-bot/src/__tests__
```
