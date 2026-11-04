# Security Intelligence And AI Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing Maintenance Agent with validated Trivy ingestion, structured technology advisories and risk enrichment, lifecycle-aware reporting, and privacy-safe OpenLIT telemetry.

**Architecture:** Keep scanning outside the long-running bot: a pinned Trivy process scans the repository and immutable production image without mounting the Docker socket into Watcher, then submits JSON to the authenticated Maintenance API. The agent normalizes all security data into its existing finding/recommendation lifecycle, reuses its scheduler and Telegram outbox, and queries OSV, CISA KEV, and FIRST EPSS through validated, failure-isolated adapters. OpenLIT initializes once in AI worker processes and exports redacted OpenTelemetry spans; the shared raw-HTTP Ollama client creates content-free spans so unsupported transport does not become an observability blind spot.

**Tech Stack:** TypeScript, Zod, Vitest, Prisma/PostgreSQL, Fastify, grammY, Trivy JSON, OSV API, CISA KEV JSON, FIRST EPSS API, OpenLIT/OpenTelemetry, Docker Compose, GitHub Actions.

**Spec:** `/Users/teapot/.codex/attachments/3fdc8ca4-352f-4c29-b8a0-7d9930454089/Pasted text.txt`

## Global Constraints

- Reuse the Maintenance Agent scheduler, findings, recommendations, outbox, authorization, logging, and deployment paths.
- Do not expose the Docker socket to the Maintenance Agent or add a long-running service.
- Keep confirmed environment findings distinct from unverified technology-watch advisories.
- Treat advisory text as data; never execute it or let it provide identifiers, versions, or exploitation claims through an LLM.
- Validate all external reports and feeds; bound timeouts/retries and isolate source failures.
- Store neither prompts nor raw model outputs by default; avoid duplicate instrumentation.

## Review Focus

- A malformed or oversized Trivy report is rejected before persistence, while an empty valid report resolves only the same target's prior confirmed findings.
- Aliased CVE/GHSA/OSV records collapse to one lifecycle identity without collapsing distinct affected packages.
- Missing CVSS/EPSS data remains absent and never becomes zero; conflicting CVSS scores retain source attribution.
- A watch advisory without deployed-version evidence is rendered as verification-required, never confirmed.
- OpenLIT-disabled processes add no exporters or console telemetry; enabled processes never capture prompt/output content.

---

### Task 1: Security Domain And Trivy Normalization

**Files:** Create `apps/maintenance-agent/src/security/{schemas,trivy,risk}.ts`; test `apps/maintenance-agent/src/__tests__/security-trivy.test.ts`; modify Prisma finding enums and generated migration.

**Interfaces:** Produce `parseTrivyReport(value)`, `normalizeTrivyReport(report, context)`, stable fingerprints, sourced CVSS records, and deterministic risk priority.

- [ ] Write fixture-driven tests for Linux/npm/Go/Rust findings, misconfigurations, aliases, missing scores, and malformed input; run them and confirm RED.
- [ ] Implement schemas and normalization using only Trivy evidence; add security finding enum values and migration.
- [ ] Run the focused tests and database generation/typecheck until GREEN.

### Task 2: Lifecycle Persistence And Authenticated Ingestion

**Files:** Modify `packages/database/src/maintenance-store.ts`, `apps/maintenance-agent/src/api.ts`, `apps/maintenance-agent/src/index.ts`; create `apps/maintenance-agent/src/security/service.ts`; tests in nearest `__tests__` directories.

**Interfaces:** Produce `SecurityIntelligenceService.ingestTrivy(report, context)` and scoped lifecycle reconciliation returning `NEW | PERSISTENT | RESURFACED | RESOLVED` counts.

- [ ] Write tests proving scoped resolution, resurface detection, API validation/authentication, and notification deduplication; confirm RED.
- [ ] Implement lifecycle reuse on `MaintenanceFinding`, preserving first/last seen and reopening resolved fingerprints.
- [ ] Run focused API, store, and service tests until GREEN.

### Task 3: Technology Watch And Risk Enrichment

**Files:** Create `apps/maintenance-agent/src/security/{watchlist,osv,enrichment,technology-watch}.ts` plus JSON fixtures and tests; modify env and scheduler wiring.

**Interfaces:** Produce validated watchlist entries with structured package/CPE identities; OSV queries; EPSS and KEV enrichers; `runTechnologyWatch()` with `Promise.allSettled()` failure isolation.

- [ ] Write tests for versioned/package-only OSV queries, false-positive prevention, Cloudflare/Vercel provider-managed classification, KEV/EPSS enrichment, and failed APIs; confirm RED.
- [ ] Implement direct official-API adapters because no maintained dependency improves the small validated HTTP boundary; preserve source URLs and score provenance.
- [ ] Integrate scheduled daily/weekly/manual execution through the existing Maintenance Agent pipeline and run focused tests until GREEN.

### Task 4: Reporting And Alert Policy

**Files:** Create `apps/maintenance-agent/src/security/reporting.ts`; modify Telegram copy/rendering and scheduling/report delivery; tests under `apps/maintenance-agent/src/__tests__`.

**Interfaces:** Produce separate confirmed/advisory sections, deterministic threshold policy, immediate-alert eligibility, daily digest, and weekly trend summaries.

- [ ] Write tests proving category separation, no unchanged re-alert, KEV priority, missing-score rendering, and Telegram limits; confirm RED.
- [ ] Implement deterministic reporting and outbox keys, then run Telegram/scheduler tests until GREEN.

### Task 5: Privacy-Safe OpenLIT Instrumentation

**Files:** Modify `packages/observability`, `packages/llm`, AI app entry points/env rendering, package manifests and lockfile; add observability/LLM tests.

**Interfaces:** Produce idempotent `initializeOpenLit(config)` and content-free Ollama spans carrying provider, model, operation, latency, status, token usage, caller, and optional run/job correlation IDs.

- [ ] Write tests for disabled/idempotent initialization, `traceContent: false`, error spans, token metrics, and correlation attributes; confirm RED.
- [ ] Add the official OpenLIT SDK and OpenTelemetry API, initialize before AI work, and manually span the custom raw-HTTP Ollama transport while disabling duplicate Ollama auto-instrumentation.
- [ ] Run focused package/app tests and typechecks until GREEN.

### Task 6: Least-Privilege Scanner Operations And Documentation

**Files:** Create `deploy/security-scan.sh` and `.github/workflows/security-scan.yml`; modify Docker/Compose mounts, render-env/presets, deployment workflow, READMEs, versioned docs, changelog, and environment inventory.

**Interfaces:** A pinned one-shot Trivy container scans read-only repository files and `ghcr.io/<namespace>/watcher:<commit-sha>`, emits JSON, and submits it to the authenticated internal API; hourly CI wakeups honor a persisted configurable interval and change indicators.

- [ ] Add shell/config tests for immutable image references, read-only mounts, no Docker socket, hash/digest skip behavior, and failure isolation; confirm RED.
- [ ] Implement scanner orchestration and deployment wiring without a new long-running service.
- [ ] Document architecture, sources, configuration, resources, retention, troubleshooting, and externally required setup.
- [ ] Run all root quality gates, database validation, Compose validation, production image build, and a final fresh-context code review.
