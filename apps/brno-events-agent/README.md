# Brno Events Agent

Internal event-discovery service for public Brno listings. It fetches independent providers, normalizes events, deduplicates cross-source coverage, evaluates relevance, persists results, and exposes authenticated endpoints used by Briefing.

Providers include Meetup, GoOut, VisitBrno/TIC, MUNI, VUT, JIC, and CEITEC. Each provider has its own enable switch, interval, URL, parser, and failure isolation. Manual source runs use the scheduled pipeline.

## API and configuration

`GET /health` is unauthenticated. Event, briefing, and manual-run routes require `Authorization: Bearer $BRNO_EVENTS_API_TOKEN`.

Configure `DATABASE_URL`, `BRNO_EVENTS_API_TOKEN`, host/port, scheduler interval, and per-provider enable/interval/URL values. See [the environment inventory](../../deploy/ENVIRONMENT.md).

See [source and API details](../../docs/brno-events-agent.md).
