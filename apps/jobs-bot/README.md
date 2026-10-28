# Jobs Bot

Jobs Bot is the persistent worker and private Telegram surface for personal job discovery. It polls permitted public feeds/APIs at 08:00, 12:00, and 19:00 in `Europe/Prague`, stores source and canonical identities in PostgreSQL, optionally mirrors every evaluated vacancy to Notion, enriches only new/changed/stale records, applies deterministic compatibility rules, and sends one digest containing only newly discovered relevant jobs. The first successful import is a baseline and deliberately sends no alerts.

## Commands

- `/start` — stable, repeat-safe entry point; it explains the workflow without changing settings or starting a run.
- `/help` — side-effect-free command list with syntax and examples.
- `/about` — explain matching scope and operational limitations.
- `/jobs_run [all|SOURCE_ID] [dry]` — run all enabled sources, one source, or a no-write dry run.
- `/jobs_status` — last run, source health, and persisted schedule.
- `/jobs_sources` — enabled/disabled adapters and reasons.
- `/jobs_latest` — ten latest jobs scoring at least 55, including IDs.
- `/jobs_show JOB_ID` — full detail, evaluation evidence, application state, and notes.
- `/jobs_search QUERY` — search stored jobs by title or company.
- `/jobs_applications [STATUS]` — inspect the saved/application pipeline.
- `/jobs_source SOURCE_ID on|off` — enable or disable an implemented source; unsupported adapters cannot be enabled.
- `/jobs_mark JOB_ID STATUS` — set the saved/application state.
- `/jobs_note JOB_ID NOTE` — append a private application note.
- `/jobs_followup JOB_ID YYYY-MM-DD|clear` — set or clear a follow-up date.
- `/jobs_profile [COMPLETE_JSON]` — show or replace the validated candidate profile.
- `/jobs_reevaluate` — immediately re-score stale stored jobs.

Every Telegram update is checked against `TELEGRAM_ALLOWED_USER_IDS`.

## Sources

This inventory is authoritative for the repository. `ACTIVE` means the built-in
adapter is enabled by default, although the operator can still turn it off with
`/jobs_source`. `CONNECTOR_REQUIRED` means the adapter exists but remains
unavailable until explicit public tenant identifiers are configured.
`UNAVAILABLE` means no verified permitted integration is currently configured.
Live health such as `HEALTHY`, `DEGRADED`, or `RATE_LIMITED` is reported by
`/jobs_sources`; it is separate from the integration state below.

| Source ID                  | Provider                          | Integration state    | Collection method or connector needed                                                                 |
| -------------------------- | --------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------- |
| `remote-frontend-jobs`     | Remote Frontend Jobs              | `ACTIVE`             | Public JSON listing API plus detail endpoint.                                                         |
| `remote-backend-jobs`      | Remote Backend Jobs               | `ACTIVE`             | Public JSON listing API plus detail endpoint.                                                         |
| `himalayas`                | Himalayas                         | `ACTIVE`             | Official public RSS feed.                                                                             |
| `startup-jobs`             | Startup Jobs (`startup.jobs`)     | `ACTIVE`             | Official engineering RSS feed; distinct from StartupJobs.cz.                                          |
| `remote-first-jobs`        | RemoteFirstJobs                   | `ACTIVE`             | Official public software-development RSS feed.                                                        |
| `we-work-remotely`         | We Work Remotely                  | `ACTIVE`             | Official public remote-programming RSS feed.                                                          |
| `remotive`                 | Remotive                          | `ACTIVE`             | Official public RSS feed.                                                                             |
| `swissdevjobs`             | SwissDevJobs                      | `ACTIVE`             | Official public RSS feed.                                                                             |
| `startupjobs-cz`           | StartupJobs.cz                    | `ACTIVE`             | Official active-offers sitemap plus rate-limited `schema.org/JobPosting` detail data.                 |
| `agoda-careers`            | Agoda Careers                     | `ACTIVE`             | Fixed public `agoda` Greenhouse board; no tenant variable is required.                                |
| `developerjobs-ch`         | DeveloperJobs.ch                  | `ACTIVE`             | Provider-owned English RSS plus rate-limited `schema.org/JobPosting` detail data.                     |
| `arbeitnow`                | Arbeitnow                         | `ACTIVE`             | Public European jobs JSON API.                                                                        |
| `jobicy`                   | Jobicy                            | `ACTIVE`             | Public remote-jobs JSON API plus batch status endpoint; only explicitly active listings are ingested. |
| `working-nomads`           | Working Nomads                    | `ACTIVE`             | Public exposed-jobs JSON API.                                                                         |
| `remote-ok`                | Remote OK                         | `ACTIVE`             | Public JSON API; missing region eligibility remains unknown.                                          |
| `greenhouse`               | Greenhouse curated boards         | `CONNECTOR_REQUIRED` | Add public board tokens to `JOBS_GREENHOUSE_BOARDS`.                                                  |
| `lever`                    | Lever curated boards              | `CONNECTOR_REQUIRED` | Add public site names to `JOBS_LEVER_SITES`.                                                          |
| `ashby`                    | Ashby curated boards              | `CONNECTOR_REQUIRED` | Add public board names to `JOBS_ASHBY_BOARDS`.                                                        |
| `smartrecruiters`          | SmartRecruiters companies         | `CONNECTOR_REQUIRED` | Add public company identifiers to `JOBS_SMARTRECRUITERS_COMPANIES`.                                   |
| `workable`                 | Workable companies                | `CONNECTOR_REQUIRED` | Add public account subdomains to `JOBS_WORKABLE_ACCOUNTS`.                                            |
| `recruitee`                | Recruitee companies               | `CONNECTOR_REQUIRED` | Add public company subdomains to `JOBS_RECRUITEE_COMPANIES`.                                          |
| `teamtailor`               | Teamtailor career sites           | `CONNECTOR_REQUIRED` | Add public career-site domains to `JOBS_TEAMTAILOR_DOMAINS`.                                          |
| `cooljobs-eu`              | CoolJobs.eu                       | `UNAVAILABLE`        | A verified permitted public feed/API connector is still needed.                                       |
| `prace-za-rohem`           | Práce za rohem                    | `UNAVAILABLE`        | A verified permitted public feed/API connector is still needed.                                       |
| `linkedin`                 | LinkedIn Jobs                     | `UNAVAILABLE`        | A permitted public job-seeker connector is needed; logged-in automation/scraping is unsupported.      |
| `jobs-cz`                  | Jobs.cz                           | `UNAVAILABLE`        | A verified permitted public feed/API connector is still needed.                                       |
| `prace-cz`                 | Prace.cz                          | `UNAVAILABLE`        | A verified permitted public feed/API connector is still needed.                                       |
| `jobstack-it`              | Jobstack.it                       | `UNAVAILABLE`        | A verified permitted public feed/API connector is still needed.                                       |
| `welcome-to-the-jungle`    | Welcome to the Jungle             | `UNAVAILABLE`        | A verified permitted public feed/API connector is still needed.                                       |
| `jobsi-cz`                 | Jobsi.cz                          | `UNAVAILABLE`        | A verified permitted public feed/API connector is still needed.                                       |
| `jenprace-cz`              | JenPrace.cz                       | `UNAVAILABLE`        | A verified permitted public feed/API connector is still needed.                                       |
| `jobs-ch`                  | Jobs.ch                           | `UNAVAILABLE`        | A verified permitted public feed/API connector is still needed.                                       |
| `jobscout24-ch`            | JobScout24.ch                     | `UNAVAILABLE`        | A verified permitted public feed/API connector is still needed.                                       |
| `english-speaking-jobs-ch` | English Speaking Jobs Switzerland | `UNAVAILABLE`        | Robots disallows automated category access and no permitted public feed/API is published.             |
| `ictcareer-ch`             | ICTcareer.ch                      | `UNAVAILABLE`        | A verified permitted public feed/API connector is still needed.                                       |
| `wellfound`                | Wellfound                         | `UNAVAILABLE`        | A verified permitted public feed/API connector is still needed.                                       |
| `flexjobs`                 | FlexJobs                          | `UNAVAILABLE`        | A verified permitted public feed/API connector is still needed.                                       |
| `eures`                    | EURES                             | `UNAVAILABLE`        | Recognized EURES partner authorization and its vacancy-export connector are required.                 |

The adapter registry is extensible. Every registry change must update this
table, the versioned Jobs Bot docs, and the inventory regression test in the
same change. Do not enable a new HTML/browser collector until its current
public collection method and terms have been reviewed. A source error is
isolated and does not cancel other adapters.

## Matching

The validated initial profile contains the supplied Jakub Vantuch CV facts, links, preferred cities, five years of development experience, and six engagements. Agency work is stored with a separate `via` field and is never represented as direct employment. Set `JOBS_CANDIDATE_NAME`, supply the complete `JOBS_CANDIDATE_PROFILE_JSON`, or edit the persisted profile with authorized `/jobs_profile`. The default profile requires evidence of Next.js, React.js, Node.js, or TypeScript, except for explicitly allowed adjacent roles such as Forward Deployed Engineer, Forward Deployed Project Manager, Technical Project Manager/Program Manager, Implementation Engineer, and Solutions Engineer. Roles centered on PHP, Java, C++, Go, .NET, or Svelte are rejected. The engine also hard-rejects Staff engineering titles, requirements above the profile's five years, explicit mandatory degrees, unqualified listings of a Computer Science or related bachelor/BS/BSc/BCS requirement, any mandatory language other than English, remote vacancies restricted outside Europe/EU/Czechia, every hybrid vacancy, onsite vacancies outside Czechia, graduate-only roles, and clearly unrelated roles. Preferred degrees and degree-or-equivalent-experience wording remain eligible. Missing remote eligibility remains `UNCERTAIN`, not invented. Full-remote vacancies receive the highest location score; IČO, B2B, contractor, freelance, and contract arrangements receive the conditions preference. Digests and `/jobs_latest` are ordered by match score from highest to lowest.

Weights are technology 30, experience 20, role 15, location 15, language 10, career direction 5, and conditions 5. Defaults: excellent 85, strong 70, possible 55, notification 70. A profile version plus job content hash caches evaluations.

Optional AI nuance scoring uses an OpenAI-compatible chat-completions endpoint, including local Ollama. The Zod-validated AI assessment contributes 25% of the final score and cannot remove deterministic hard blockers. Provider/model/prompt/token metadata is stored with the cached evaluation. Any timeout, HTTP failure, or malformed output falls back to deterministic scoring for that job.

## Configuration

Required:

- `DATABASE_URL`
- `JOBS_TELEGRAM_TOKEN`
- `TELEGRAM_ALLOWED_USER_IDS`

Optional:

- `JOBS_TIMEZONE` (default `Europe/Prague`)
- `JOBS_HEALTH_PORT` (default `4090`)
- `JOBS_SCHEDULER_INTERVAL_MS` (default `30000`)
- `JOBS_DETAIL_REFRESH_HOURS` (default `72`)
- `JOBS_CANDIDATE_NAME`
- `JOBS_CANDIDATE_PROFILE_JSON`
- `JOBS_AI_ENABLED` (default `false`)
- `JOBS_AI_BASE_URL` (default `http://host.docker.internal:11434`), `JOBS_AI_MODEL` (default `qwen3:8b`), `JOBS_AI_API_KEY` (optional), and `JOBS_AI_TIMEOUT_MS` (default `45000`)
- `JOBS_EMAIL_WEBHOOK_URL`, `JOBS_EMAIL_WEBHOOK_API_KEY`, `JOBS_EMAIL_RECIPIENT` — optional e-mail gateway accepting `{to, subject, text, html}` JSON.
- `NOTION_API_KEY`, `JOBS_NOTION_DATA_SOURCE_ID`, `NOTION_API_VERSION` — optional paired Notion integration and `Job Opportunities` data source; the API version defaults to `2026-03-11`.
- `JOBS_GREENHOUSE_BOARDS`, `JOBS_LEVER_SITES`, `JOBS_ASHBY_BOARDS`, `JOBS_SMARTRECRUITERS_COMPANIES`, `JOBS_WORKABLE_ACCOUNTS`, `JOBS_RECRUITEE_COMPANIES`, and `JOBS_TEAMTAILOR_DOMAINS` — optional comma-separated public tenant identifiers. Empty values keep the respective ATS unavailable.
- `LOG_LEVEL`

## Run

```bash
pnpm db:generate
pnpm db:deploy
pnpm --filter @watcher/jobs build
pnpm --filter @watcher/database build
pnpm --filter @watcher/jobs-bot dev
```

Production uses `deploy/runtime/jobs-bot.env` and service `jobs-bot`. The internal readiness endpoint is `http://jobs-bot:4090/healthz`. PostgreSQL constraints and notification keys make repeated runs idempotent; no Redis or host cron is used.

When Notion is configured, the bot mirrors both matching and rejected evaluated vacancies, including score, technologies, source links, blockers, and uncertainties. `Watcher Job ID` plus persisted sync state prevents duplicate pages, existing evaluated jobs are backfilled on startup, and Notion failures do not stop collection or Telegram delivery. Share the target database with the same internal integration represented by `NOTION_API_KEY`, then set its data-source ID in `JOBS_NOTION_DATA_SOURCE_ID`; PostgreSQL remains authoritative.

All review and application-state operations stay in the authorized Telegram bot; there is no jobs web UI. The bot never submits applications or contacts employers.

## Limitations

- RSS feeds usually do not expose a separate detail endpoint; their supplied description is treated as detail content.
- The exact application link is checked before each new matching alert, regardless of hostname. Confirmed closed links are not alerted or shown by `/jobs_latest`. Scheduled runs also revalidate up to 25 stale matching links per run, five at a time, with a 24-hour freshness window. Explicit apply controls can produce `OPEN_CONFIRMED`; HTTP 404/410 or closure text such as Greenhouse's “no longer open” response produces `CLOSED_CONFIRMED`; otherwise the job remains `LISTED_UNVERIFIED` or `UNKNOWN`. Aggregator presence alone never confirms availability.
- Company ATS adapters require explicit public board/account identifiers; the bot does not enumerate tenants or infer private career sites. Agoda is the documented built-in exception because its public `agoda` Greenhouse board is fixed and verified.
- StartupJobs.cz discovery uses its official active-offers sitemap and only the standardized `schema.org/JobPosting` block from public detail pages. It does not log in, crawl disallowed paths, or parse private/internal candidate data.
- E-mail delivery requires an operator-provided HTTP mail gateway; SMTP credentials are not embedded in the worker.
- Notion synchronization requires the database to be shared with the configured internal integration. Manual edits are not imported back into PostgreSQL.
