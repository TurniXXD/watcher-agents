# Bot integration

## Brno Events agent

`apps/brno-events-agent` keeps its own operational database (Watcher PostgreSQL),
crawling, deduplication, scheduling, and briefing/Telegram publication. The CMS
integration is additive and optional:

```
source adapters ─▶ normalization ─▶ validation ─▶ cross-source dedup (BrnoEvent)
      │                                                   │
      │                                    ┌──────────────┴─────────────┐
      ▼                                    ▼                            ▼
 briefing events (Telegram, unchanged)   brno_event_cms_sync outbox   source health
                                           │  (own 60 s timer)
                                           ▼
                          free-food classification + CMS item mapping
                                           ▼
                          POST /api/ingest/v1/events (batch ≤ 50, Idempotency-Key)
                                           ▼
                          Payload: draft → editorial review → publication
```

- **Stable identity:** `externalId = brno-event:<BrnoEvent.id>`. Cross-source copies
  are merged by the agent before sending, so one CMS event per real event.
- **Durable outbox:** `EventRepository.save` marks new/changed events `PENDING` in
  `brno_event_cms_sync` (same database as the event). Unchanged sightings back-fill
  events stored before the integration and re-confirm synced events at most daily
  (keeps `lastVerifiedAt` fresh).
- **Never blocks Telegram:** source runs only write the outbox row; delivery happens
  on a separate timer (`CONTENT_CMS_SYNC_INTERVAL_MS`). A CMS outage leaves rows
  `PENDING` with exponential backoff (30 s doubling to 6 h, ±20% jitter); after
  `CONTENT_CMS_SYNC_MAX_ATTEMPTS` they become `FAILED` until the event changes or an
  operator re-queues them.
- **Retry safety:** the payload is rebuilt from the current event at send time; the
  delivery hash avoids resending unchanged content; batches carry a deterministic
  `Idempotency-Key`; the CMS upsert is idempotent per external id.
- **Skipped:** placeholder titles (TBA/TBD) and events that ended more than a day ago.
- **Copyright:** the agent sends an original factual summary (category, venue,
  organiser), not the organiser's prose. A 600-character excerpt goes to the
  internal `sourceExcerpt` for editors only; image URLs go to the internal
  `sourceImageUrl` and are never republished automatically. Every source link is
  sent as attribution.

Agent endpoints (bearer `BRNO_EVENTS_API_TOKEN`): `GET /cms/status` (outbox counts),
`POST /cms/sync` (flush now), `POST /cms/retry-failed` (re-queue FAILED rows).

### Enabling

```bash
pnpm --filter @watcher/content-cms credentials:create -- --bot brno-events-agent --scopes events
# On the VPS render inputs: CONTENT_CMS_INGEST_TOKEN=<token> [CONTENT_CMS_URL=http://vantuch-content-cms:3000]
```

Both `CONTENT_CMS_URL` and `CONTENT_CMS_INGEST_TOKEN` must be set together; without
them the agent behaves exactly as before.

## Free-food classification

Implemented in `apps/brno-events-agent/src/domain/free-food.ts`. It is
deterministic, sentence-based, and works on diacritics-insensitive Czech and
English text from the title, description, and price text.

| Result    | When                                                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yes`     | Explicit free food: “free pizza”, “complimentary lunch”, “food provided at no charge”, “občerstvení zdarma”, “pizza zdarma”, “jídlo v ceně vstupu” **with free admission**                  |
| `no`      | Explicit absence: “no food provided”, “food available for purchase”, “bring your own lunch”, “občerstvení není zajištěno”, “občerstvení si hradí každý”, food included in a **paid** ticket |
| `unknown` | Nothing explicit, generic “refreshments”/“občerstvení zajištěno”, free admission alone, or contradictory statements                                                                         |

Free admission (`isFree`) is never used as evidence of free food. Matching source
sentences are sent as `foodEvidence` (stored internally) and the CMS rejects
`yes`/`no` without evidence. Editors can override `freeFood` in the admin; the
override is a human edit and later bot changes become proposals.

## Adding another bot

1. Create a scoped credential: `credentials:create -- --bot news-bot --scopes news`.
2. Map the bot's normalized items to the collection's ingest schema (see
   `/api/ingest/openapi.json`; generate types with `openapi-typescript`).
3. Use a stable `externalId` per real-world item, batch requests, send an
   `Idempotency-Key`, and retry only 5xx/429/409 or items with `retryable: true`.
4. Keep delivery off the bot's critical path (outbox or background queue in its
   existing database) so Telegram delivery never waits for the CMS.
5. Never send copied full texts or images without rights; use `sourceReferences`
   for attribution and `aiProvenance` for generated content.
