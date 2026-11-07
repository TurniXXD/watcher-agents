# Continuous CRM Prospecting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator start an always-running, bounded discovery stream that writes newly researched companies to Twenty without manually repeating `/sales_prospects`.

**Architecture:** Reuse the persisted Sales search subscription and existing `syncProspects` path. An auto-import flag and page offset distinguish CRM streams from Telegram-only searches. The existing worker claims one page at a time, continues after a short provider cooldown, and recovers after a process restart; it never contacts companies or enrolls them in Quickly.

**Tech Stack:** TypeScript, grammY, PostgreSQL, Prisma, Zod, Vitest.

**Spec:** User request in this chat on 2026-11-07: continuous discovery and CRM writing, without a scheduled report.

## Global Constraints

- One operator starts a stream with an explicit business type and locality; no mandatory personal seed query.
- Geoapify Places paging uses a stable category and locality with `limit` and `offset`.
- Rate-limit requests with a minimum one-minute cooldown and back off after failures; a worker does not issue an unbounded tight loop.
- Preserve the current Telegram-only `/sales_search` and one-shot `/sales_prospects` semantics.
- Persist stream configuration, cursor, and claim state in PostgreSQL; reuse prospect idempotency.

## Review Focus

- A repeated page must not create duplicate Twenty companies or Notes.
- A page with no results must wrap to page zero so newly listed companies can be found later.
- A failed provider or CRM call must not advance the cursor silently.
- Restart or shutdown during a batch must not leave the stream permanently stuck or start overlapping work.
- An unauthorized or stopped stream must not search or write to Twenty.

---

### Task 1: Persist and page continuous searches

**Files:** `packages/database/prisma/schema.prisma`, a new migration, `packages/database/src/sales-store.ts`, `packages/sources/src/company/ares.ts`, `apps/sales-bot/src/geoapify.ts`, `apps/sales-bot/src/service.ts`, nearest tests.

- [ ] Write failing tests for persisted auto mode and offset, claim lease, offset propagation, and empty-page wrap.
- [ ] Run focused tests to verify the failures.
- [ ] Add the migration and minimal pagination and store behavior.
- [ ] Regenerate Prisma Client and run focused tests and typechecks.

### Task 2: Run and control the stream

**Files:** `apps/sales-bot/src/periodic-search.ts`, `apps/sales-bot/src/bot.ts`, `apps/sales-bot/src/index.ts`, nearest tests.

- [ ] Write failing tests for the CRM stream, missing Twenty/Geoapify configuration, authorization, stop, and restart-safe progress.
- [ ] Run focused tests to verify the failures.
- [ ] Add `/sales_auto` to create or resume a stream and use the existing `/sales_search_stop` to stop it; execute CRM pages from the running worker.
- [ ] Run focused tests and typechecks.

### Task 3: Document and verify

**Files:** `apps/sales-bot/README.md`, `apps/docs/content/docs/bots/sales-bot.mdx`, `deploy/ENVIRONMENT.md`, bot help/about copy.

- [ ] Explain the continuous worker, one-minute cooldown, CRM prerequisites, stream command, stop command, and source limits.
- [ ] Run the required root format, lint, typecheck, test, build, and database-validation gates once after final edits.
