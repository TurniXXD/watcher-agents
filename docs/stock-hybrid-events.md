# Hybrid stock-event processing

The stock watcher keeps its existing cron collectors and reconciliation runs. It also exposes `StockCandidateProcessor.processStockCandidate()` over the existing `InProcessEventBus` for ticker-scoped `stock.news.discovered`, `stock.earnings.detected`, `stock.market_anomaly.detected`, and `stock.event.updated` events. Market-wide discovery uses this path immediately, and the existing PostgreSQL event journal records internal event publication. No external broker was added; persisted scheduled reconciliation remains the recovery mechanism after a process restart.

## Pipeline

1. Sources persist normalized `ProcessedItem` evidence.
2. Ticker resolution and deterministic multi-type classification produce a canonical-event candidate.
3. Exact identity, ticker/time, compatible types and normalized-title evidence narrow possible clusters.
4. If configured, the existing Ollama embedding provider queries the existing pgvector PostgreSQL database. Semantic similarity is accepted only with deterministic type/catalyst and title support.
5. The latest stored market snapshot and independent-source count re-evaluate materiality. A 5% daily move, 2.5x return/volatility ratio, 3x median volume, or 4% gap triggers analysis; 8% moves or 5x volume normally promote to HIGH, while three independent sources promote a supported LOW cluster to MEDIUM.
6. HIGH and EXTREME events always claim analysis, even when the normal run cap is exhausted. Analysis state is persisted as `PENDING`, `ANALYZING`, `ANALYZED`, `SKIPPED`, or `FAILED`.
7. Zod-validated market impact separates the likely primary catalyst, secondary catalysts, amplifiers, market reaction, direction, magnitude, confidence, and thesis impact. Provider-supplied EPS, revenue, margin, guidance, cash-flow, and balance-sheet deltas are retained when present and are never synthesized when absent.
8. One unique alert may be queued per watcher/event. Non-extreme alerts wait for the configured batch window. Outside local notification hours they wait until morning. EXTREME may be delivered immediately when enabled.
9. Canonical stock events continue to publish into the existing briefing event repository. Briefing's semantic story matcher suppresses unchanged repetition while retaining real developments and all evidence links.

## Vector reuse and failure behavior

`BRIEFING_EMBEDDING_MODEL`, `BRIEFING_EMBEDDING_MIN_SIMILARITY`, and `BRIEFING_EMBEDDING_WINDOW_HOURS` configure both stock and briefing similarity. Vector dimensions are obtained from Ollama and checked dynamically with `vector_dims`; there is no hard-coded dimension or dedicated vector index. Queries narrow by ticker and time before cosine distance. Failed embedding generation or persistence is logged and falls back to deterministic clustering without failing ingestion.

`StockEventVectorStore.findSimilarHistoricalEvents()` retrieves older semantically similar canonical events with event types, materiality, prior analysis and nearby stored price/volume reaction when available. It is reusable analysis context but is not injected into every LLM request, keeping latency and prompt size controlled.

## Current limitations

- The internal event bus is process-local. It intentionally is not a distributed queue; scheduled reconciliation catches missed external discoveries.
- Fundamental deltas are included only when a provider supplies them. Missing revenue, EPS, margin, guidance, debt or cash values are never synthesized.
- Small event volumes use bounded exact pgvector scans. Add an ANN index only after measured query volume justifies it.
- A canonical event is not re-notified for another merely supporting article. A genuinely different fingerprint/event can produce a new alert; richer within-event versioned re-notification remains conservative.
