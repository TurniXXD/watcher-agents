# Brno Events Agent

`brno-events-agent` is a private Fastify service that polls public Brno event listings, normalizes and scores events, deduplicates cross-source copies, and stores source provenance in PostgreSQL. It is not a Telegram bot and does not use Ollama.

The registry covers Meetup, GoOut, VisitBrno/TIC, MUNI, VUT, JIC, CEITEC, Velvet Innovation, SideQuesty, Objev Brno, Impact Hub Brno, Base48, and ČSOB Start it @UNI Validation Camps. Each provider has an isolated adapter and schema.org `Event` JSON-LD remains a shared fallback rather than the only input. Override any listing with `<SOURCE>_URL` and disable it with `<SOURCE>_ENABLED=false`. Facebook and Instagram are intentionally not scraped.

Provider strategies are deliberately different:

- Meetup reads the public Next.js event payload and falls back to Event JSON-LD. Its authenticated GraphQL API is not required.
- GoOut reads server-rendered event cards and Event JSON-LD.
- VisitBrno/TIC reads and follows the public calendar's bounded pagination, including titles, date ranges, links, and images.
- MUNI reads and follows the official calendar pagination, including descriptions and date ranges.
- VUT reads its server-rendered official event calendar. The available RSS feed contains publication dates rather than event dates, so it is not used as event timing authority.
- JIC reads event cards with Czech date/time, description, venue, and event URL.
- CEITEC uses its public event JSON endpoint with Zod validation and falls back to Event JSON-LD if the endpoint is unavailable.
- Objev Brno reads structured event cards embedded in its public free-event page and treats free admission as a property of that curated catalogue.
- Impact Hub Brno reads the site's public iCalendar feed and retains Brno events only.
- Base48 derives the public CalDAV export from its published Nextcloud embed URL and expands bounded weekly recurrences with exclusions.
- ČSOB Validation Camps are read from the official annual CSR calendar; only rows that explicitly publish a Brno date are imported.

All adapters have provider-specific fixture tests. A source may still return zero events when the upstream page is empty or no valid future event can be parsed; invalid data is never fabricated. VIDA!, Hvězdárna, Eventbrite, Brno Expat Centre, KAM, other individual venues, Facebook, and Instagram remain deferred until a stable public endpoint or reusable authenticated integration is available.

`GET /health` is public. All other endpoints require `Authorization: Bearer $BRNO_EVENTS_API_TOKEN`: `GET /events`, `/events/:id`, `/events/upcoming`, `/events/briefing`, `POST /run`, and `POST /run/:source`. The briefing endpoint returns structured JSON only.

All stored timestamps are UTC. Source-provided ISO timestamps should include their offset; Czech local parsing uses `Europe/Prague` process configuration. Each source has its own polling interval, source failures are isolated, and manual endpoints use the same runner as scheduling.

## Configuration

Required variables are `DATABASE_URL` and a random `BRNO_EVENTS_API_TOKEN` of at least 16 characters. The listener defaults to `127.0.0.1:4020` outside Compose. `BRNO_EVENTS_SCHEDULER_INTERVAL_MS` controls how often due sources are checked; it does not override their individual polling intervals. Source defaults range from 180 minutes for Meetup, Impact Hub, and SideQuesty through 720 minutes for JIC, CEITEC, and ČSOB Validation Camps.

Every source supports `<SOURCE>_ENABLED=true|false`, `<SOURCE>_URL`, and `<SOURCE>_INTERVAL_MINUTES`; the added source identifiers are `OBJEV_BRNO`, `IMPACT_HUB_BRNO`, `BASE48_CALENDAR`, and `CSOB_VALIDATION_CAMPS`. Keep `TZ=Europe/Prague` so local calendar boundaries, Czech date parsing, and iCalendar recurrence remain DST-aware.

## API examples

```bash
curl http://127.0.0.1:4020/health

curl -H "Authorization: Bearer $BRNO_EVENTS_API_TOKEN" \
  "http://127.0.0.1:4020/events/upcoming?minRelevance=80&category=ai&limit=20"

curl -X POST -H "Authorization: Bearer $BRNO_EVENTS_API_TOKEN" \
  http://127.0.0.1:4020/run/goout
```

`GET /events/briefing` returns bounded structured sections for `today`, `tomorrow`, `thisWeekend`, `newInterestingEvents`, `registrationDeadlines`, and `topUpcoming`. Event entries include source links and explainable relevance reasons. No endpoint generates prose.
