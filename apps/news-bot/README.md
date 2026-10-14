# News Bot

Private Telegram watcher for built-in and custom RSS/Atom feeds. It normalizes and deduplicates entries, applies structured significance/relevance analysis, filters disabled categories, and publishes durable `news` events for Briefing.

The Global profile contains public news, science, technology, health, European, and space feeds. The retired Czech profile and GDELT-only entries remain disabled. Topics start empty and steer relevance without inventing facts. Custom feed URLs and redirects are checked against unsafe network targets.

## Commands

Use `/start`, `/help`, `/topics`, `/feeds`, `/feed_add`, `/feed_remove`, `/categories`, `/run`, `/schedule`, `/pause`, `/resume`, `/status`, and `/about`. `/help` shows every available feed, topic, category, and scheduling command.

## Configuration

Configure `DATABASE_URL`, `NEWS_TELEGRAM_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS`, the Ollama connection, source concurrency/backoff, and `DEFAULT_TIMEZONE`. See [the environment inventory](../../deploy/ENVIRONMENT.md).

## Development

```bash
pnpm --filter @watcher/news-bot typecheck
pnpm exec vitest run apps/news-bot/src/__tests__
```
