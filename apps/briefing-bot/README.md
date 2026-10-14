# Briefing Bot

Private Telegram bot that combines watcher events with weather, Google Calendar, stock earnings, goals, and optional Notion journal context, writes one bounded spoken briefing through Ollama, synthesizes it with Piper, and delivers audio plus a compact Telegram index.

## Architecture

`BriefingCoordinator` loads independent context in parallel, clusters and ranks persisted watcher events, calls `BriefingScriptGenerator`, passes the result through the existing Piper TTS provider, and uses the idempotent delivery service. Scheduled, manual, and test runs share this pipeline. A failed optional context source degrades the run without blocking the remaining briefing.

See [the detailed architecture](../../docs/morning-briefing-architecture.md).

## Commands

Core commands include `/start`, `/help`, `/briefing`, `/briefing_test`, `/briefing_time`, `/briefing_duration`, `/briefing_max_duration`, `/briefing_transcript`, `/subscriptions`, `/location_set`, `/voice_set`, `/calendar_connect`, `/goals`, `/goal_add`, `/journal`, `/journal_status`, `/journal_cancel`, `/journal_reminder_test`, `/agents`, `/trigger`, and `/schedules`. `/help` is the authoritative complete command list.

## Configuration

Required runtime values are `DATABASE_URL`, `BRIEFING_TELEGRAM_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS`, `OLLAMA_URL`, and `OLLAMA_MODEL`. Piper paths and scheduler/freshness bounds have safe defaults. Set optional `BRIEFING_BIRTH_DATE=YYYY-MM-DD` to include the operator's age at each goal deadline; goal lists always include the remaining or overdue duration in years. Google Calendar and Notion are optional and validate as complete credential groups. Evening journaling defaults to `JOURNAL_ENABLED=true`, `JOURNAL_REMINDER_TIME=21:00`, and `JOURNAL_TIMEZONE=Europe/Prague`. Voice journaling additionally needs an OpenAI-compatible `/audio/transcriptions` endpoint in `JOURNAL_TRANSCRIPTION_URL`; its model defaults to `whisper-1`, and `JOURNAL_TRANSCRIPTION_API_KEY` is optional for a trusted local endpoint.

Use [the briefing preset](../../deploy/presets/briefing-bot.env.example) and shared [environment inventory](../../deploy/ENVIRONMENT.md).

## Notion Daily Journal

At 21:00 Prague time the bot offers text reflection, one-message voice reflection, a 30-minute postponement, or skipping the day. The six-question text flow saves every answer immediately and resumes after restarts. The voice flow keeps no audio, transcribes in memory, asks Ollama to structure only facts present in the transcript, and always shows an editable preview before confirmation. Confirmed entries are retried locally when Notion is unavailable. Existing manual Notion text is never silently overwritten; a conflict requires manual resolution.

See [the complete evening-journal workflow and operations guide](../../docs/evening-journal.md).

Morning briefings can add a Czech `Včerejší reflexe` section from the previous Prague calendar day's explicit `Date` property. The client retrieves all paginated and nested blocks, extracts the six Czech reflection sections, never logs or persists journal text, and omits a missing entry. Duplicate dates are rejected as ambiguous; an API failure does not stop the briefing.

Create an internal Notion integration with read content permission. Database/view setup also needs insert and update content permission. Share the parent page and run:

```bash
NOTION_API_KEY=<secret> NOTION_PARENT_PAGE_ID=<page-id> \
  pnpm --filter @watcher/briefing-bot notion:setup
```

If `📓 Daily Journal` already exists, do not run setup. Share it with the integration and configure its data-source ID:

```dotenv
NOTION_API_KEY=<internal-integration-secret>
NOTION_JOURNAL_DATA_SOURCE_ID=<data-source-id>
NOTION_API_VERSION=2026-03-11
TIMEZONE=Europe/Prague
```

Finish the native template in Notion because the API does not author or select the desired default template:

1. Create a database template with `Date` set to relative **Today**.
2. Add `🌤️ Co jsem dnes zažil a udělal?`, `😊 Co mi dnes udělalo radost?`, `🧩 Co se nepovedlo a proč?`, `📚 Co nového jsem se naučil?`, `🔄 Co bych příště udělal jinak?`, and `🎯 Jaká je jedna priorita na zítřek?` as headings.
3. Make it the default and leave recurrence disabled.
4. Keep `Chronologicky`, or create a view sorted by `Date` descending when reusing a database.

Notion has no native unique constraint. Check that today's row does not exist before clicking **New**; the programmatic journal path queries the explicit `Date`, updates its own prior content when safe, and refuses duplicate or conflicting rows.

Verify access without printing private text:

```bash
pnpm --filter @watcher/briefing-bot notion:check
```

## Development

```bash
pnpm --filter @watcher/briefing-bot typecheck
pnpm exec vitest run apps/briefing-bot/src/__tests__
```
