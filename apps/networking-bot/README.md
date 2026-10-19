# Networking Bot

Private Telegram bot for a personal professional network and event workflow. It is the canonical home for Google Sheets contact management, business-card OCR, semantic contact search, event recommendations, attendance tracking, debriefs, and reminders. Socials Bot no longer registers networking commands; Sales keeps the shared contact commands only for backward compatibility.

## Contacts and business cards

The contact repository is an existing private Google Sheet with exactly eleven columns: `Jméno`, `Datum potkání`, `Místo potkání`, `Telefon`, `Email`, `Web`, `sociální síť`, `Poznámka k potkání`, `Typ kontaktu`, `Domluvena další schůzka`, and `Aktivní kontakt`. Share only that spreadsheet with the configured Google service account.

Send a business-card photo directly to the bot. The configured Ollama vision model extracts only visible fields, the bot checks e-mail/phone/LinkedIn/name duplicates, displays a preview, and writes only after explicit confirmation. Without a vision model, manual contact entry and search still work when Google Sheets is configured.

## Events

`Brno Events Agent` supplies normalized events from Meetup, GoOut, VisitBrno/TIC, MUNI, VUT, JIC, CEITEC, Velvet Innovation Meetups, and SideQuesty. Provider runs are isolated and event identity is deduplicated before the Networking Bot imports recommendations. A source not explicitly marking an event free never becomes free by assumption.

Commands:

- `/start`, `/help`, `/networking_help` — complete guide.
- `/about` — purpose, data flow, privacy guarantees, and operational limits.
- `/networking` — attendance state plus recommended events; `prefs cities=Brno; radius=80; max=0; count=5; monday=on` updates preferences.
- `/network_events`, `/network_events_free`, `/network_event_add`, `/network_sources` — event discovery and source status.
- `/network_event_contacts` — private contacts and follow-ups tied to confirmed event attendance.
- `/network_add`, `/network_search`, `/network_contact`, `/network_update`, `/network_intro`, `/network_followups`, `/network_context` — Google Sheets personal network.

## Configuration

Start from [the Networking preset](../../deploy/presets/networking-bot.env.example). `DATABASE_URL`, `NETWORKING_TELEGRAM_TOKEN`, and `TELEGRAM_ALLOWED_USER_IDS` are required. The three Google Sheets credential values must be configured together. `OLLAMA_URL` and `OLLAMA_MODEL` are paired; `NETWORK_OLLAMA_VISION_MODEL` additionally enables business-card photos and must support image input.

The health endpoint listens inside the container on `NETWORKING_HEALTH_PORT` (default `4070`). Production runs the `networking-bot` Compose service from the shared immutable Watcher image. Ollama remains external.

## Development

```bash
pnpm --filter @watcher/networking-bot typecheck
pnpm exec vitest run apps/networking-bot/src packages/contact-network/src
pnpm --filter @watcher/networking-bot build
```

The bot authorizes every command, callback, photo, and text message through `TELEGRAM_ALLOWED_USER_IDS`. It never messages contacts automatically and never invents missing card or event data.
