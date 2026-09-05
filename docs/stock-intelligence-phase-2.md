# Stock Intelligence Engine: Phase 2 event intelligence

Phase 2 turns normalized stock observations into durable canonical events before any expensive model call. It adds deterministic event extraction, cross-source deduplication, event chains, company-relative materiality, analysis cooldowns, and persistent source health. Publications retain their existing item pipeline but share source-health backoff.

## Processing flow

```text
source response
  -> validated normalized observation
  -> exact provider identity
  -> deterministic event extraction
  -> exact/fuzzy canonical-event match
  -> evidence attachment / event chain
  -> materiality gate
  -> event + ticker cooldown claim
  -> existing Ollama stock analysis
```

Raw observations are always stored before event processing. Market-price snapshots remain observations; they are not promoted to canonical events without an anomaly baseline. Price, volume, and options anomaly construction belongs to Phase 4.

## Canonical event model

`CanonicalEvent` stores ticker, event type, title, occurrence/public/detection times, direction, magnitude, surprise, materiality score/reasons, action, primary evidence, primary driver, chain, and analysis timestamps. `EventObservation` is the many-to-many evidence link and records whether the observation created, confirmed, analyzed, or was cooldown-suppressed. `EventChain` groups a primary driver with later confirmations or interpretations.

Exact event identity prefers a SEC accession parsed from the official archive URL. Otherwise the fingerprint uses ticker, event type, date bucket, and normalized title tokens. A second deterministic gate compares same-ticker/same-type reports in a bounded time window using token similarity. Earnings reports detected in the same window collapse even when an analyst headline differs from the official filing. Primary evidence is promoted according to regulator/official source, investor relations, news, analyst, then market-data priority.

This deliberately does not use embeddings or the LLM for deduplication. It is inexpensive and auditable, though less capable than semantic entity/event extraction. False merges and misses should be measured through replay before thresholds are loosened.

## Materiality and cost gate

The gate maps events to `NONE`, `LOW`, `MEDIUM`, `HIGH`, or `EXTREME` and persists an intended action. Routine Form 4 and Form 144 observations are always low materiality unless a later specialized insider classifier produces genuinely different evidence. They are stored without an Ollama call and do not imply insider-trading violations.

Strategic/regulatory keywords, primary-source quality, and explicit normalized financial facts influence the score. If a trusted adapter supplies `contractValueUsd`, `financialImpactUsd`, `transactionValueUsd`, or `aggregateMarketValue`, the amount is compared with stored market capitalization. For example, a $50M contract can be extreme for a $300M company and low for a $500B company. Missing scale remains unknown; it is never invented from prose.

Medium and higher events may use Ollama. The stored action distinguishes targeted, full, and immediate analysis for Phase 5, but Phase 2 still invokes the existing stock-analysis schema for all admitted events. It does not yet maintain a thesis or run a separate targeted-analysis pass.

## Cooldowns

- Same event: six hours by default.
- Same ticker: 30 minutes by default.
- Independent high/extreme events bypass the ticker cooldown, but still require a unique event claim.

Claims are persisted and transactionally guarded in PostgreSQL so two bot users cannot independently trigger the same work. Values are configurable through `STOCK_EVENT_COOLDOWN_MINUTES` and `STOCK_TICKER_ANALYSIS_COOLDOWN_MINUTES`.

## Source health

Each watcher/source/target combination persists `HEALTHY`, `DEGRADED`, `RATE_LIMITED`, or `UNAVAILABLE`, consecutive failures, attempt/success/failure timestamps, last error, and `backoffUntil`. Failures use bounded exponential backoff; HTTP 429/rate-limit errors start with a longer delay. A successful later check resets the health row. Backoff skips are surfaced as source failures instead of being silently ignored.

Each run reports successful versus expected sources as data coverage. This is operational coverage only; Phase 5 will add weighted signal-group coverage and material data gaps.

## Known limitations

- Event extraction is deterministic English-language rules, not semantic NLP.
- Direction and surprise stay `UNKNOWN` unless future adapters provide explicit structured facts.
- Fuzzy deduplication can miss substantially different headlines and may require replay-driven tuning.
- Event chains currently connect analyst/secondary interpretations to a recent material driver. Market reactions wait for Phase 4 anomaly detection.
- Source fallback adapters and daily reconciliation are Phase 7 work; Phase 2 records/backoffs failures and allows later successful checks to recover health.
- No alert, recommendation, thesis state, or automated trade action is created in this phase.
