# Stock Intelligence Phase 7

Phase 7 turns the persisted event, thesis, and decision layers into an operator-facing live system. The user interface remains Telegram; no web dashboard, queue service, or additional infrastructure service is introduced.

## Durable live alerts

A successful stock analysis evaluates a deterministic alert policy in the same database transaction that stores the thesis revision. An alert is generated when at least one of these conditions is true:

- canonical-event materiality is `HIGH` or `EXTREME`;
- attention crosses `ALERT_ATTENTION_THRESHOLD`;
- the persisted verdict, thesis, or decision asymmetry changes;
- an active or upcoming catalyst is `EXTREME`;
- at least three distinct insider buyers form the existing 30-day purchase cluster;
- a price or volume anomaly remains unexplained by confirmed public evidence.

`(watcherConfigId, eventId)` is unique, so replays and repeated source confirmations cannot generate another alert for the same watcher event. Delivery is claimed in PostgreSQL, attempts are counted, successful delivery is timestamped, and Telegram failures return the alert to the pending set for a later run. The alert links to primary evidence and always says that unexplained activity does not imply an information leak or guaranteed trade.

High/extreme evidence continues to activate the Phase 3 `EVENT_MODE` lifecycle. Its fast-source polling interval and expiry remain controlled by `DISCOVERY_HIGH_RESOLUTION_INTERVAL_MINUTES` and `DISCOVERY_EVENT_MODE_MINUTES`.

## Daily reconciliation

Each Stocks watcher receives a persisted reconciliation schedule. The default is every 1,440 minutes. Reconciliation clears an active per-source backoff window for one recovery attempt and then invokes exactly the same source preparation, normalization, canonical-event deduplication, cooldown, targeted analysis, and digest path as a normal run.

It therefore checks every enabled source and catches content missed during temporary provider failures, but it does not perform full analysis for every company. Existing processed items are skipped, duplicate observations attach to their existing canonical event, low-materiality events remain stored-only, and full thesis analysis runs only when the targeted change gate requires it. `/reconcile` starts the same operation manually.

## Telegram dashboard and opportunity feed

- `/dashboard` shows company/ticker, latest price and daily move, monitoring tier/mode, verdict, attention, net signal, supported 30-day probability range, asymmetry, nearest catalyst, insider conviction, data coverage, thesis change, and last event/update.
- `/opportunities` filters that view to stocks with attention of at least 70, a watch-like recommendation, or positive decision asymmetry.
- `/alerts` shows recent alerts and whether they were delivered or remain pending.
- `/health` shows run and reconciliation state, next checks, source health/backoff, rate limits, analysis queue depth, failures, duplicates prevented, generated/pending alerts, LLM calls/tokens/estimated cost, and average analysis and alert latency.

Ollama is local, so its estimated monetary cost is recorded as zero. Token counters and model duration are populated when Ollama returns them. Provider subscription fees are not inferred from request volume.

## Operational limits

- Telegram delivery and the PostgreSQL confirmation cannot be one atomic transaction. The system favors retrying an unconfirmed alert over silently losing it; a process failure immediately after Telegram accepts a message can therefore cause a rare duplicate retry.
- Metrics are service-level application observability. Host CPU, RAM, GPU, disk, and Ollama daemon telemetry remain the responsibility of the server monitoring stack.
- The opportunity feed is research prioritization, not an order queue. Every decision remains subject to human review.
