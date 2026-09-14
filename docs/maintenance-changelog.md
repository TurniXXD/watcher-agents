# Maintenance Agent Project Updates

Each code update that changes runtime behavior must add a concise entry here. The maintenance bot announces each entry once per authorized Telegram chat; delivery state is persisted by content hash.

## 2026-09-14 — Briefing cluster persistence isolation

- A historical story-cluster membership conflict is now logged with bounded event context and isolated to that cluster instead of aborting the entire briefing before Telegram delivery.
- The current in-memory cluster remains available for ranking and delivery while the persisted conflict can be investigated separately.

## 2026-09-14 — Stock allocation research command

- Added `/allocation [--amount-czk AMOUNT] [--days DAYS]`, which ranks enabled watchlist tickers using the persisted decision engine, expected value, selected probability horizon, confidence, and coverage.
- When a Czech-koruna amount is supplied, it creates a transparent research allocation only across tickers that pass the existing model threshold and have a better-than-even probability for the selected horizon; no trade is executed and an ineligible universe remains unallocated.

## 2026-09-13 — Compact watched-ticker command

- Added `/stocks_tickers`, which returns only enabled ticker symbols from the current watchlist, one per line, without company names, status, mode, priority, or source details.

## 2026-09-13 — Live on-demand stock thesis refresh

- `/thesis SYMBOL` now runs the regular source pipeline only for that configured ticker before returning its thesis, without sending a second manual-run digest.
- When a ticker has no thesis yet, the targeted run may bootstrap one from the strongest available event after checking live sources. Normal scheduled materiality gates and overlap protection remain unchanged.

## 2026-09-13 — Bounded and conservatively scored publication digests

- Publications runs now analyze and deliver at most 15 papers, while preserving the existing fair rotation across configured topics; a lower configured cap is still honored.
- Publication importance uses a conservative evidence rubric independent of topic relevance. Routine, exploratory, preclinical, and single-cohort studies should normally remain below 7, while scores 9-10 are reserved for rare field-changing or independently replicated breakthroughs.

## 2026-09-13 — Fair Ollama queue warnings

- Normal and low-priority Ollama requests waiting for 30 seconds are promoted to FIFO order, preventing repeated high-priority briefing work from starving producer scans.
- A small serialized queue is no longer reported as a backlog before the active request's declared timeout; genuinely stuck requests and oversized queues still alert immediately.

## 2026-09-13 — Persistent News category controls

- Added separate persistent category switches for Czech and Global News profiles.
- SPORT now defaults to disabled in both profiles and is excluded from manual digests, scheduled digests, and Personal Briefing input regardless of its scores.
- RSS items carrying an upstream sport category are discarded before Ollama analysis; remaining articles are still blocked after classification as a second guard.
- Missing Ollama news titles now safely reuse the sourced article title, and an expected active GDELT rate-limit backoff is no longer repeated as a Telegram feed error.
- Added `/categories`, `/category_enable PROFILE CATEGORY`, and `/category_disable PROFILE CATEGORY` commands.

## 2026-09-12 — Actionable maintenance recommendations

- Source recovery closes failure proposals immediately instead of retaining historical incidents as current recommendations.
- Overlapping recurring-failure and source-degradation proposals are consolidated into one recommendation per agent and source.
- Normal upstream filtering is no longer mistaken for negative consumer feedback.
- `/recommendations` shows at most eight active proposals and includes the concrete evidence behind each one.

## 2026-09-09 — Unified maintenance observability

- Added the maintenance agent with deterministic health, quality, latency, cost, source, schedule, noise, classification, and duplication checks.
- Added a shared structured observability contract and normalized historical telemetry import for all current agents.
- Added evidence-backed findings, human-approved recommendations, authenticated API endpoints, periodic reports, and one-time Telegram project-update announcements.
- No recommendation can modify production code, configuration, schedules, sources, database schema, or deployments automatically.

## 2026-09-09 — Maintenance signal accuracy

- Added explicit low-value feedback and producer-to-briefing usage mismatch findings.
- Added output-volume regression detection against each agent's own historical baseline.
- Corrected watcher duplicate telemetry so processing limits and previously stored items are not mislabeled as duplicates.
- Restricted optional self-review to maintenance failures, latency, and cost, and made scheduler shutdown cancel its pending jitter timer.
- Preserved original source-run timestamps during historical telemetry refreshes and made failed changelog announcements retryable.
- Added recent concrete source errors to recurring-failure evidence.

## 2026-09-11 — Fair publication topic selection and bioRxiv recovery

- Publication analysis limits now select candidates round-robin across topics instead of allowing the alphabetically first query to monopolize a run.
- Newest papers are preferred within each topic and topic order rotates deterministically per run.
- Empty, malformed, or truncated JSON receives one bounded retry, fixing transient bioRxiv `Unexpected end of JSON input` failures.
- Telegram digests group a shared provider failure across all affected queries instead of repeating the same error hundreds of times.

## 2026-09-10 — Server capacity alerts and debug run reports

- Added sustained CPU, memory, GPU, and VRAM capacity warnings with cooldown and recovery notifications.
- Added persistent `/debug on|off|status` controls and deduplicated Telegram reports for newly completed bot runs.
- Added per-run process CPU time, average CPU use, peak RSS, and peak heap telemetry to Stocks, Publications, News, MU Clubs, Brno Events, and Briefing runs.
- GPU readings use NVIDIA or AMD host interfaces when exposed and are clearly marked unavailable otherwise.

## 2026-09-11 — Live agent status command

- Added `/about` with the Maintenance Agent's purpose, workflow, and safety boundaries.
- Added `/status` to probe every other bot's internal health endpoint on demand.
- Combined live readiness with latest-run freshness and recent normalized run/source errors.
- Added configurable stale and error lookback windows and redacted sensitive error details from Telegram output.
- Corrected host RAM measurement through `/proc/meminfo`, exposed read-only host process and DRM views, and added the top CPU/RAM/GPU processes to capacity alerts.
