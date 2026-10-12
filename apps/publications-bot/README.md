# Publications Bot

Private Telegram watcher for publication and clinical topics using PubMed, bioRxiv, ClinicalTrials.gov, and openFDA.

The query list starts empty. Topics are stored exactly for display and in normalized form for duplicate protection. CSV import accepts a `query` or `topic` column. Independent sources use failure isolation; one failure does not cancel the digest. Scheduled empty runs are silent, while manual `/run` reports that nothing new was found.

## Commands

Use `/queries`, `/add_query`, `/add_queries`, `/remove_query`, `/sources`, `/run`, `/schedule`, `/pause`, `/resume`, `/status`, and `/about`.

## Configuration

Use [the publications preset](../../deploy/presets/publications-bot.env.example). Configure `DATABASE_URL`, `PUBLICATIONS_TELEGRAM_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS`, Ollama values, and `DEFAULT_TIMEZONE`. Provider backoff and concurrency bounds have safe defaults.

## Development

```bash
pnpm --filter @watcher/publications-bot typecheck
pnpm exec vitest run apps/publications-bot/src/__tests__
```
