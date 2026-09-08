# Brno Events Agent

`brno-events-agent` is a private Fastify service that polls public Brno event listings, extracts schema.org Event JSON-LD, normalizes and scores events, deduplicates cross-source copies, and stores source provenance in PostgreSQL. It is not a Telegram bot.

The first registry covers Meetup, GoOut, VisitBrno/TIC, MUNI, VUT, JIC, and CEITEC. Public pages differ and can change; adapters deliberately return no events when a listing exposes no Event JSON-LD rather than relying on brittle CSS selectors. Override any listing with `<SOURCE>_URL` and disable it with `<SOURCE>_ENABLED=false`. Facebook and Instagram are intentionally not scraped.

Each v1 adapter uses public schema.org `Event` JSON-LD and has fixture-based normalization coverage. GoOut currently exposes usable event records. Other providers may return zero events when their listing page does not expose structured events; this is an explicit degraded capability, not fabricated data. Impact Hub, VIDA!, Hvězdárna, Eventbrite, Brno Expat Centre, KAM, individual venues, Facebook, and Instagram remain deferred until a stable public structured endpoint or an existing reusable authenticated integration is available.

`GET /health` is public. All other endpoints require `Authorization: Bearer $BRNO_EVENTS_API_TOKEN`: `GET /events`, `/events/:id`, `/events/upcoming`, `/events/briefing`, `POST /run`, and `POST /run/:source`. The briefing endpoint returns structured JSON only.

All stored timestamps are UTC. Source-provided ISO timestamps should include their offset; Czech local parsing uses `Europe/Prague` process configuration. Each source has its own polling interval, source failures are isolated, and manual endpoints use the same runner as scheduling.

## Configuration

Required variables are `DATABASE_URL` and a random `BRNO_EVENTS_API_TOKEN` of at least 16 characters. The listener defaults to `127.0.0.1:4020` outside Compose. `BRNO_EVENTS_SCHEDULER_INTERVAL_MS` controls how often due sources are checked; it does not override their individual polling intervals. The source interval defaults are `180` minutes for Meetup, `360` for GoOut, VisitBrno, MUNI, and VUT, and `720` for JIC and CEITEC.

Every source supports `<SOURCE>_ENABLED=true|false`, `<SOURCE>_URL`, and `<SOURCE>_INTERVAL_MINUTES`, where `SOURCE` is `MEETUP`, `GOOUT`, `VISITBRNO`, `MUNI`, `VUT`, `JIC`, or `CEITEC`. Keep `TZ=Europe/Prague` so local calendar boundaries and Czech date parsing remain DST-aware.

## API examples

```bash
curl http://127.0.0.1:4020/health

curl -H "Authorization: Bearer $BRNO_EVENTS_API_TOKEN" \
  "http://127.0.0.1:4020/events/upcoming?minRelevance=80&category=ai&limit=20"

curl -X POST -H "Authorization: Bearer $BRNO_EVENTS_API_TOKEN" \
  http://127.0.0.1:4020/run/goout
```

`GET /events/briefing` returns bounded structured sections for `today`, `tomorrow`, `thisWeekend`, `newInterestingEvents`, `registrationDeadlines`, and `topUpcoming`. Event entries include source links and explainable relevance reasons. No endpoint generates prose.
