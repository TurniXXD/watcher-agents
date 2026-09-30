# OSINT investigation architecture

## Repository audit (phase 0)

| Existing component                                               | Reuse                                                                                                                                          |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/utils/network.ts`                             | Reject private and special-purpose URLs, including DNS resolution, before public HTTP collection.                                              |
| `packages/sources/src/web/public-html.ts`                        | Bounded, redirect-aware website retrieval instead of a second scraper.                                                                         |
| `packages/core/src/provider-limiter.ts` and `transient-retry.ts` | Existing provider pacing/retry patterns reviewed for bounded collection.                                                                       |
| `packages/core/src/scheduler.ts`                                 | Scheduling patterns reviewed; the opt-in OSINT bot uses a persisted `OsintWatch` row and a small in-process poller, with no new queue service. |
| `packages/database` and Prisma migrations                        | Store investigations, selectors, evidence, entities, provenance and runs in the existing PostgreSQL instance.                                  |
| `packages/telegram`                                              | Private-user authorization and Telegram rendering utilities.                                                                                   |
| `packages/llm`                                                   | Optional structured Ollama generation after deterministic evidence collection.                                                                 |
| Shared Watcher image and Compose                                 | Run OSINT as an opt-in long-running bot using the existing release image and database migration gate.                                          |
| Vitest, CI, structured logger                                    | Test pure routing/parsing and failure paths; keep the existing merge gate.                                                                     |

There is no general-purpose OSINT entity/evidence model, collector registry, investigation service or conversation state in Watcher. Those belong in `apps/osint-bot/src` (domain and source-specific adapters) and `packages/database` (persistence). The existing Watcher pipeline targets scheduled articles and stock observations, so forcing person/company investigations into `WatchItem` would lose selector, entity and provenance semantics. The OSINT collector contract is therefore small and app-owned; it reuses Watcher's HTTP, scheduling, authorization and LLM utilities rather than copying them.

## Safety and rollout

- Public/official sources only; no login automation, CAPTCHA bypass or unrestricted browser agents.
- Evidence is immutable and separately identified. A relationship must point to evidence; a model response cannot create a database fact.
- An IČO is a strong organization identity key. A name alone never merges people or organizations.
- Personal details such as birth dates and home addresses from registry payloads are not retained unless genuinely necessary. Default reports show public professional roles, not a personal dossier.
- Investigations currently select at most `OSINT_MAX_COLLECTORS` collectors and have a 75-second request deadline. Expansion is explicit, not recursive; `depthLimit` is reserved for future bounded traversal. Collector failures are reported as partial results.
- Unimplemented sources are shown as unsupported, not silently represented as collected.

## Implemented slice and limitations

The opt-in `osint-bot` supports IČO lookups through official ARES subject and public-register endpoints, plus public domain website metadata and DNS. Evidence, entities, observations, relationships, collector outcomes, current Telegram context and watch state persist in Watcher's PostgreSQL. Statutory records retain only names, roles and public role dates; birth dates and personal addresses are discarded before storage. Registered-seat addresses are retained only for CZSO legal-form codes 112 (s.r.o.) and 121 (a.s.), not for sole traders or unclassified forms. Per-source failures are isolated. Website metadata does not establish legal ownership of the domain by a company.

Company-name discovery, Justice documents, Registr smluv, ISIR, RÚIAN, RDAP, archives, PDF extraction, a public OSINT API, graph-search/ranking and the remaining requested collectors are **not yet implemented**. Name/email/person selectors are retained but never silently converted to an unsupported search. `OsintWatch` rechecks once daily by default and only notifies on new normalized evidence; it is not a durable multi-worker lease. Ollama is optional and may write only labeled, cited inference/hypothesis text in a Telegram report, never database facts.
