# Events API

`GET /api/public/v1/events`

| Parameter  | Default    | Description                                                                                             |
| ---------- | ---------- | ------------------------------------------------------------------------------------------------------- |
| `city`     | `brno`     | Case/diacritics-insensitive city; `all` disables the filter                                             |
| `category` | –          | Category slug (e.g. `ai`, `workshop`)                                                                   |
| `from`     | now        | `YYYY-MM-DD` (start of that day in Europe/Prague) or ISO timestamp with offset; includes running events |
| `to`       | –          | `YYYY-MM-DD` (inclusive day in Europe/Prague) or ISO timestamp with offset                              |
| `q`        | –          | 2–100 chars; searches title, summary, venue, organizer                                                  |
| `limit`    | 20         | 1–100                                                                                                   |
| `cursor`   | –          | `nextCursor` from the previous page (bound to the sort)                                                 |
| `sort`     | `startsAt` | `startsAt` (nearest first), `-startsAt`, `-updatedAt`                                                   |
| `free`     | –          | `true`: free admission; `false`: explicitly paid                                                        |
| `freeFood` | –          | `true`: only `freeFood = "yes"`; `false`: everything else                                               |
| `featured` | –          | `true`/`false`                                                                                          |

Filters combine with AND. Without `from`/`to`, only upcoming or still-running
events are returned. Date-only values follow Europe/Prague DST rules
(e.g. `to=2026-03-28` ends at `2026-03-28T23:00:00Z`).

## Pagination

Keyset pagination over `(sort field, id)`: deterministic even when many events
share a start time, and stable while new events are inserted. Request pages until
`nextCursor` is `null`. A cursor from a different `sort` is rejected with 400.

```bash
curl 'https://cms.vantuch.dev/api/public/v1/events?freeFood=true&category=ai&limit=10'
curl 'https://cms.vantuch.dev/api/public/v1/events?limit=10&cursor=eyJzIjoic3RhcnRzQXQiLCJ2Ijo…'
curl 'https://cms.vantuch.dev/api/public/v1/events?from=2026-12-01&to=2026-12-31&city=all'
```

## Response

```json
{
  "data": [
    {
      "id": "0f8e2a52-7d2c-4c55-9e85-3b7f1f0a9c11",
      "slug": "example-ai-meetup-2026-11-20",
      "title": "Example AI meetup",
      "summary": "Ai event in Brno at Example venue.",
      "description": null,
      "startsAt": "2026-11-20T17:00:00.000Z",
      "endsAt": "2026-11-20T19:00:00.000Z",
      "timezone": "Europe/Prague",
      "city": "Brno",
      "venueName": "Example venue",
      "address": null,
      "category": "ai",
      "tags": ["ai", "networking"],
      "organizerName": "Example organiser",
      "sourceUrl": "https://example.com/events/ai-meetup",
      "registrationUrl": null,
      "imageUrl": null,
      "isFree": true,
      "price": 0,
      "currency": null,
      "freeFood": "yes",
      "foodDetails": "Free pizza",
      "status": "scheduled",
      "featured": false,
      "lastVerifiedAt": "2026-11-06T08:00:00.000Z",
      "updatedAt": "2026-11-06T08:00:00.000Z"
    }
  ],
  "nextCursor": null,
  "meta": { "limit": 20 }
}
```

Differences from the editorial model: `image` becomes `imageUrl` (only licensed,
public media); `eventStatus` is exposed as `status`; `description` is plain text;
`foodDetails` is `null` when `freeFood` is `unknown`. Cancelled and postponed
events stay listed with their status so the website can label them.

## Free food

`freeFood` is `yes` only when the source explicitly confirms free food (with
stored evidence); `no` only when it explicitly says food is not free/provided;
otherwise `unknown`. It is independent from free admission (`isFree`). Editors
can override it. See [bot integration](bot-integration.md#free-food-classification).

## Other endpoints

- `GET /events/:slug` → `{ "data": PublicEvent }` or 404.
- `GET /events/featured` → same as the list with `featured=true`.
- `GET /events/categories?city=brno` → `{ "data": [{ "slug": "ai", "label": "Ai" }], "meta": { "city": "brno" } }`.
