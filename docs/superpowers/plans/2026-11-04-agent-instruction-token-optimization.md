# Agent Instruction Token Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce always-loaded agent context and repeated validation/tool-output cost without weakening Watcher's engineering, security, deployment, testing, or Telegram-bot contracts.

**Architecture:** Keep a concise root `AGENTS.md` with universal rules and mandatory conditional links. Move domain-specific detail into focused files under `docs/agent/` so agents load it only for relevant work.

**Tech Stack:** Markdown, repository instruction discovery, pnpm quality gates.

**Spec:** User-requested token audit based on `/Users/teapot/.codex/attachments/4b64a3d2-376a-469e-8abd-2827f6d25e8d/Pasted text.txt`.

## Global Constraints

- Preserve every material rule from the current root `AGENTS.md`.
- Keep `apps/docs/AGENTS.md` unchanged.
- Do not modify global Codex configuration.
- Add explicit narrow-iteration, single-final-gate, output-bounding, and duplicate-command guidance.

## Review Focus

- Conditional references must be mandatory for tasks in their scope.
- Telegram authorization, idempotency, runtime, documentation, and completion rules must remain intact.
- Deployment backup, migration, immutable image, rollback, and secret-handling rules must remain intact.
- Root quality gates must remain mandatory exactly once after the last relevant edit.
- The root file must be materially smaller than its original 22,516 characters.

---

### Task 1: Extract scoped contracts

**Files:**

- Create: `docs/agent/telegram-bot-contract.md`
- Create: `docs/agent/documentation.md`
- Create: `docs/agent/deployment.md`
- Create: `docs/agent/testing.md`

- [x] Move the existing detailed rules into the matching focused references without weakening them.
- [x] Add the measured validation and tool-output efficiency rules to the testing reference.
- [x] Verify all four files exist and contain their required headings and key contracts.

### Task 2: Slim the always-loaded root instructions

**Files:**

- Modify: `AGENTS.md`

- [x] Replace scoped detail with mandatory conditional links.
- [x] Retain universal scope, stack, ownership, pipeline, source/LLM, and security rules.
- [x] Verify links resolve, key rules remain discoverable, formatting is clean, and root `AGENTS.md` is below 10,000 characters.
