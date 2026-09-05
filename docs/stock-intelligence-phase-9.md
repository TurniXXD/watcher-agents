# Stock Intelligence Phase 9

Phase 9 validates the stored intelligence system against later market outcomes without introducing look-ahead data or fabricated prices.

## Historical and event replay

`/replay SYMBOL DATE` reconstructs the latest thesis, price snapshot, and canonical events that were actually available to that Telegram watcher at the requested UTC timestamp. An event is visible only when it had already been detected and its primary evidence had already been published. A thesis revision is visible only after its own creation time and only when its processed evidence was already published. Later filings, articles, revisions, prices, and outcomes are excluded.

`/eventreplay SYMBOL [FROM] [TO]` returns canonical-event detections and persisted thesis transitions in chronological order. It replays the immutable states the live engine actually stored; it does not ask the current LLM to invent a counterfactual historical answer.

## Outcome validation

`/validate` builds or refreshes persisted outcomes for three target classes:

- thesis revisions, anchored at revision creation;
- alerts, anchored at first event detection;
- canonical signal events, anchored at first detection.

The validator only uses `MarketSnapshot` rows already stored in PostgreSQL. It records the price at detection, next stored open, pre-detection move, 1-hour, 1/7/30/90-day and 12-month returns, maximum favorable excursion (MFE), and maximum adverse excursion (MAE). A horizon is null unless a real snapshot exists inside its explicit tolerance window. In particular, daily feeds normally cannot produce a 1-hour result.

Running validation again is idempotent through the `(watcherConfigId, targetType, targetId)` constraint. A second overlapping validation is rejected, and a failed run is persisted with its error.

## Reports and guardrails

`/backtest` reports sample size, hit rate, average and median return, MFE, and MAE for each horizon. Thirty-day breakdowns are persisted for verdict, sector, catalyst, signal type and combination, confidence band, attention band, and market regime. Alert timing separately compares movement before detection with the next stored open.

`/calibration` compares the midpoint of the model's stored 30-day probability range with realized positive returns in fixed 50–55, 55–60, 60–65, 65–70, 70–80, and 80%+ buckets. Raw LLM probabilities are not trusted or rewritten automatically.

`/signalperformance` groups 30-day outcomes by canonical signal type, including insider, earnings, clinical/FDA, government contract, patent, congressional, options, price, volume, short-interest, and Quiver-derived events. Groups below `VALIDATION_MIN_SAMPLE_SIZE` remain visible but are marked insufficient. No automatic model-weight update is performed.

## Limitations

- Results begin only after enough live price snapshots have accumulated; Watcher does not silently download or synthesize missing historical prices.
- Corporate actions are represented only to the extent already reflected by the configured price source.
- Backtests measure the behavior of stored Watcher outputs. They are not trading advice and do not include commissions, slippage, taxes, or portfolio construction.
