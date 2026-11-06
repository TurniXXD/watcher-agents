# Ingestion API

Versioned, authenticated, machine-to-machine API for bots. OpenAPI:
`/api/ingest/openapi.json`, Swagger: `/api/ingest/docs` (both require a CMS login).

| Method | Path                          | Scope          |
| ------ | ----------------------------- | -------------- |
| POST   | `/api/ingest/v1/events`       | `events`       |
| POST   | `/api/ingest/v1/articles`     | `articles`     |
| POST   | `/api/ingest/v1/news`         | `news`         |
| POST   | `/api/ingest/v1/publications` | `publications` |
| POST   | `/api/ingest/v1/social-posts` | `social-posts` |
| GET    | `/api/ingest/v1/runs/:id`     | any (own runs) |

## Authentication and credentials

Each bot has its own credential with explicit collection scopes:

```bash
pnpm --filter @watcher/content-cms credentials:create -- \
  --bot brno-events-agent --scopes events --name "Brno events agent" --expires-days 365
```

Administrators can also use _Administration → Bot Credentials → Create bot
credential_ in the admin (admin-only `POST /api/ingest/credentials`). Both print
`vch_<16 hex keyId>_<43 char secret>` **once**. Only its
SHA-256 hash is stored (constant-time comparison). Send it as
`Authorization: Bearer <token>`.

- **Rotation:** create a second credential for the same bot, deploy it, then untick
  _Active_ (or set _Expires at_) on the old one under _Administration → Bot Credentials_.
- Credentials can never publish; created content is always an unpublished draft.
- Admin users manage credentials; the token cannot be recovered after creation.

## Requests

- `Content-Type: application/json`, body `{"items": [...]}`, 1–`INGEST_MAX_BATCH_SIZE`
  (default 100) items, at most `INGEST_MAX_BODY_BYTES` (default 1 MB).
- Items are validated individually; one invalid item does not fail the batch.
- Upserts are idempotent per `(collection, botId, externalId)` (unique index).
- Optional `Idempotency-Key` (8–128 chars `[A-Za-z0-9_.:-]`): a replay returns the stored
  run with `Idempotent-Replayed: true`; a concurrent duplicate returns 409.
- Rate limit: `INGEST_RATE_LIMIT_PER_MINUTE` per credential (default 60), plus 20 failed
  authentications per minute per client IP. 429 responses include `Retry-After`.

```bash
curl -X POST https://cms.vantuch.dev/api/ingest/v1/events \
  -H "Authorization: Bearer $CONTENT_CMS_INGEST_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: brno-2026-11-06T10:00Z-batch-1' \
  -d '{
    "items": [{
      "externalId": "brno-event:0f8e2a52-7d2c-4c55-9e85-3b7f1f0a9c11",
      "title": "Example AI meetup",
      "summary": "Ai event in Brno at Example venue.",
      "startsAt": "2026-11-20T18:00:00+01:00",
      "endsAt": "2026-11-20T20:00:00+01:00",
      "city": "Brno",
      "venueName": "Example venue",
      "category": "ai",
      "sourceUrl": "https://example.com/events/ai-meetup",
      "isFree": true,
      "freeFood": "yes",
      "foodDetails": "Free pizza",
      "foodEvidence": [{ "text": "Free pizza and drinks after the talks." }],
      "sourceReferences": [{ "title": "Example listing", "url": "https://example.com/events/ai-meetup" }]
    }]
  }'
```

Response (`200`; `422` when every item failed):

```json
{
  "runId": "92bc8933-66bf-45aa-be18-275e36553a20",
  "status": "succeeded",
  "collection": "events",
  "startedAt": "2026-11-06T10:00:00.000Z",
  "completedAt": "2026-11-06T10:00:00.120Z",
  "counts": {
    "received": 1,
    "created": 1,
    "updated": 0,
    "proposed": 0,
    "skipped": 0,
    "failed": 0
  },
  "results": [
    {
      "index": 0,
      "externalId": "brno-event:…",
      "outcome": "created",
      "id": "…",
      "slug": "example-ai-meetup-2026-11-20"
    }
  ]
}
```

Item outcomes: `created`, `updated` (applied to the draft), `proposed` (pending
update created), `unchanged`, `skipped` (`source_blocked`, `target_deleted`),
`failed` (`validation_failed` with `details`, or `internal_error` with
`retryable: true`). Bots should retry only retryable failures and 5xx/429/409.

## Validation highlights

- Timestamps must carry an offset; `timezone` must be an IANA zone (default `Europe/Prague`).
- URLs must be `http(s)`; `sourceUrl` is required for events (attribution).
- `freeFood: "yes"` or `"no"` **requires** `foodEvidence`; otherwise send `"unknown"`.
- `sourceImageUrl` is stored for editors and never published automatically.
- `sourceExcerpt` is internal context and never published.

## Errors

All errors use `{"error": {"code", "message", "requestId?", "details?"}}` and never
expose stack traces. Codes: `unauthorized` (401), `forbidden` (403 scope),
`validation_failed`/`bad_request` (400), `conflict` (409), `payload_too_large` (413),
`unsupported_media_type` (415), `rate_limited` (429), `internal_error` (500).

## Audit

Every run is stored in _Operations → Ingestion Runs_ (bot, key id, counts,
per-item results, errors, request id). Logs include `audit: "ingestion"` lines for
runs and `audit: "ingestion-auth"` lines for rejected credentials (never the token).
