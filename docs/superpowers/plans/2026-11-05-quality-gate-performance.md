# Quality Gate Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce local lint, formatting, typecheck, and test latency without weakening CI coverage or changing application behavior.

**Architecture:** Keep root quality gates authoritative, prune generated artifacts at each tool boundary, and store disposable caches under a git-ignored repository-local directory. Preserve serial execution only for PostgreSQL integration tests while allowing independent unit-test files and Turbo typecheck tasks to run concurrently.

**Tech Stack:** pnpm, Turborepo, ESLint flat config, Prettier, TypeScript, Vitest.

**Spec:** User request in this chat; no repository spec file.

## Global Constraints

- Keep all root quality-gate commands and CI coverage intact.
- Do not change application runtime behavior.
- Do not hide source files or required Next.js generated route types.
- Keep PostgreSQL-backed integration tests serial against the shared test database.

## Review Focus

- A generated `__tests__` path must not be discovered by Vitest.
- Next.js `.next/types` and `.next/dev/types` must remain part of docs typechecking.
- A clean CI checkout must build the shared package declarations required by type-aware ESLint.
- ESLint and Prettier caches must be local, content-based, and git-ignored.
- Coverage mode must execute the same unit and integration test inventory as normal mode.

---

### Task 1: Baseline and root-cause evidence

**Files:**

- No repository files modified.
- Evidence: `/tmp/watcher-before-*.log` and `/tmp/watcher-before-*.time`.

- [x] Measure `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, and `pnpm test`.
- [x] Count generated files and inspect each tool's discovery patterns.
- [x] Record existing failures separately from performance findings.

### Task 2: Tool boundaries and local caches

**Files:**

- Modify: `.gitignore`
- Modify: `.prettierignore`
- Modify: `eslint.config.mjs`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/docs/package.json`
- Modify: `tsconfig.base.json`
- Modify: `apps/docs/tsconfig.json`
- Modify: `vitest.config.ts`

- [x] Create temporary generated fixtures and verify current Prettier/Vitest discovery includes them where applicable.
- [x] Add explicit generated-output exclusions without excluding source or Next.js route types.
- [x] Add separate content-based ESLint and Prettier caches beneath `.cache/`.
- [x] Keep TypeScript 7 as the compiler while exposing the supported TypeScript 6 API to typed ESLint.
- [x] Limit lint's prerequisite build to shared workspace packages.
- [x] Split Vitest into parallel unit and serial PostgreSQL integration projects.
- [x] Re-run generated-fixture discovery checks and remove the fixtures.

### Task 3: Verification and benchmark

**Files:**

- Inspect all Task 2 files and the final git diff.
- Evidence: `/tmp/watcher-after-*.log` and `/tmp/watcher-after-*.time`.

- [x] Measure cold and warm formatting/lint behavior and the post-change typecheck/test gates.
- [x] Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` after the last edit.
- [x] Run `pnpm test:coverage` to prove coverage remains wired to the complete test inventory.
- [x] Report before/after wall times and any pre-existing verification blockers.
