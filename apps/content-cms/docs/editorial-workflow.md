# Editorial workflow

## Review status vs. publication status

Every publishable collection (events, articles, news, publications, social posts)
has two independent states:

| Field          | Values                                                         | Meaning                       |
| -------------- | -------------------------------------------------------------- | ----------------------------- |
| `reviewStatus` | `ingested`, `needs_review`, `approved`, `rejected`, `archived` | Editorial decision            |
| `_status`      | `draft`, `published` (Payload drafts)                          | Whether a live version exists |

Rules, enforced server-side in `src/hooks/editorial.ts` for the admin, REST,
Local API, bulk edits, and scheduled jobs:

- Bot content is created as a **draft** with `reviewStatus: ingested`.
- Only `approved` content can be published. Publishing anything else fails.
- `rejected` content is never public: rejecting live content unpublishes it, and
  bots can never reopen it (later submissions only refresh the snapshot).
- `archived` content leaves public listings but remains reachable by slug.
  Archived content cannot be newly published.
- Bots (ingestion context) can never publish.
- The public API additionally filters on `_status = published` and review status,
  so a misconfigured hook cannot leak drafts.

Review decisions made through a **draft save** on already-published content are
mirrored to the live row immediately (reject/reopen → unpublish; archive → hidden
from listings) and trigger website revalidation.

## Roles

| Role       | Can                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------- |
| `editor`   | Create and edit content and media, move items to Needs Review, resolve pending updates      |
| `reviewer` | Everything an editor can, plus approve/reject/archive, publish/unpublish, make media public |
| `admin`    | Everything, plus users, bot credentials, settings, deletes                                  |

The first registered user becomes `admin`. Only admins can change roles.
Editors cannot change or revert a reviewer's decision.

## Typical flow

1. Open **Events → Needs Review / Ingested** (quick filters above every list).
2. Edit facts if necessary, write an original summary, attach licensed media only.
3. A reviewer sets **Review status → Approved** and clicks **Publish** (or schedules
   publication with Payload's _Schedule Publish_). Bulk approval: select rows →
   _Edit_ → Review status → Approved, then bulk _Publish_.
4. Use **Featured**, **Event status** (scheduled/cancelled/postponed), and **Archived**
   as needed. Version history is available on every document (max 50 versions each).
5. Previews: with `WEBSITE_PREVIEW_URL` and `PREVIEW_SECRET` configured, the
   _Preview_ button opens a signed (HMAC, 1 hour) link on the website.

Articles, news, and publications also have **Publish at** (embargo): published
content stays out of the public API until that time; the _Scheduled_ quick
filter lists such items.

## Preserving human edits

The ingestion service compares each bot submission with the **previous bot
snapshot** (stored in _Bot Snapshots_), not with the editorial document:

| Situation                                                                                | Result                                       |
| ---------------------------------------------------------------------------------------- | -------------------------------------------- |
| Identical submission                                                                     | No write, no version (`unchanged`)           |
| Field changed by bot, not by a human, record still Ingested/Needs Review and unpublished | Applied to the draft (`updated`)             |
| Field changed by bot but the editorial value differs from the old snapshot (human edit)  | Proposed in **Pending Updates** (`proposed`) |
| Record approved or published                                                             | Non-critical changes are always proposals    |
| Record rejected                                                                          | Snapshot refreshed only                      |

Edited bot-managed fields are also listed in the read-only `humanEditedFields`
sidebar field. A record with proposals shows **Has pending updates**.

### Resolving pending updates

Open **Operations → Pending Updates**, untick changes you do not want, and set
**Status** to **Applied** (selected values are written to the editorial draft;
a reviewer publishes as usual) or **Dismissed**. One pending record per document
accumulates the latest proposals.

## Safety policy for cancellations and date changes

Materially wrong live information must not stay visible:

- A **cancellation or postponement** reported by the bot is applied to the live
  event immediately, even over human edits; the override is recorded in the
  pending update (`autoApplied`, severity _critical_) for review.
- A **date/time change** on a published event is applied live immediately when no
  human edited those fields.
- If a human edited the dates and the bot reports different ones, the change is a
  **critical** proposal and the event gets `criticalUpdatePendingSince`. If not
  resolved within **Settings → criticalUpdateGraceHours** (default 48 h), the event
  is hidden from the public API until an editor applies or dismisses the proposal.

## Corrections and removal requests

- Reject or archive the listing (immediately removed from public listings).
- To stop a source permanently, add it under **Assets → Sources** and tick
  **Ingestion blocked**; future bot items whose source URL is on that domain are skipped.
- Publish the contact in **Settings → correctionsContactEmail** on the website.
