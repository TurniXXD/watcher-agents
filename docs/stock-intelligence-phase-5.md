# Stock Intelligence Phase 5

Phase 5 turns admitted canonical events into incremental company understanding. It adds targeted event analysis, primary-driver classification, weighted signal groups, material data coverage, change detection, and versioned persistent thesis state.

## Analysis flow

1. The database builds an evidence bundle containing the current thesis, current scores, active catalysts, recent canonical events, latest market context, insider conviction, and per-signal data availability.
2. Ollama performs a constrained targeted analysis and returns materiality, information/thesis change, affected signal groups, primary driver, risks, confidence, and whether full reanalysis is required.
3. A full thesis update runs only when there is no existing thesis, the canonical event action is full/immediate analysis, or targeted analysis explicitly requires it.
4. Deterministic code applies evidence reliability and redundancy multipliers, calculates bull/bear/net signal, discounts confidence for missing data, and persists the resulting state.

An analyst interpretation receives a `0.50` multiplier when it follows a known primary driver. A price/volume/options reaction linked to a driver receives `0.25`. Independent evidence receives `1.00`; duplicate observations never reach analysis.

## Data availability and coverage

All thirteen signal groups are classified as `AVAILABLE`, `DATA_UNAVAILABLE`, or `NOT_APPLICABLE`. Weighted coverage excludes `NOT_APPLICABLE`; missing configured data contributes zero, lowers coverage, and is surfaced as a material gap. A successful source check with no activity is still available evidence.

The current public/free source set cannot provide dependable options or institutional-positioning coverage, so these remain explicit gaps rather than neutral signals. Source health and enabled-source state feed the coverage calculation.

## Persistence and Telegram

`CompanyThesisState` stores the latest state per ticker. `ThesisRevision` provides an immutable event/analysis audit trail, and a durable `thesis.updated` domain event records key state changes. `/thesis SYMBOL` renders the latest state; normal run digests include change class, primary driver, scores, coverage, and whether full analysis ran.

No probability, expected-value, or recommendation logic is derived from the Phase 5 net signal. Those are Phase 6 concerns.
