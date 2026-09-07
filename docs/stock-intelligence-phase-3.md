# Stock Intelligence Engine: Phase 3 discovery

Phase 3 finds unusual US-listed stocks with a cheap aggregate market scan, temporarily investigates qualified candidates, and automatically changes monitoring resolution based on durable event evidence. Broad scanning is deterministic and never invokes Ollama.

## Discovery flow

```text
Alpha Vantage market snapshot
  -> deterministic price/liquidity/ticker filters
  -> SEC company and exchange resolution
  -> persisted discovery signal
  -> DISCOVERY/unknown -> INVESTIGATE + HIGH_RESOLUTION
  -> immediate run of every enabled company source
  -> repeated SEC/IR/GDELT/TradingView/price checks
  -> HIGH/EXTREME canonical event -> WATCH + EVENT_MODE
  -> timeout/expiry -> NORMAL or DISCOVERY + LOW_RESOLUTION
```

`ALPHA_VANTAGE_API_KEY` enables the scanner. An empty value disables only market-wide discovery; manually configured stocks and both normal watcher schedules keep working. `EOD` is the default scan mode and interval is one day. `DELAYED` and `REALTIME` select intraday mode and must match the provider entitlement.

The adapter validates the external JSON response with Zod and normalizes top gainers, top losers, and most-active entries. Provider errors and rate-limit messages become explicit failed discovery scans. The API key remains in the server runtime environment and is never included in structured logs or Telegram output.

## Quality and duplicate controls

Candidates must satisfy all configured checks:

- absolute price move;
- current price and volume;
- current dollar volume (`price × volume`);
- supported ticker format;
- successful SEC issuer resolution;
- configured SEC exchange allowlist;
- optional OTC exclusion.

The aggregate endpoint does not expose market capitalization or historical average volume. Watcher therefore does not claim to enforce those unavailable filters. They can be added when a licensed structured fundamentals provider is introduced.

The provider's snapshot identity, ticker, price, move, and volume form a stable SHA-256 fingerprint. PostgreSQL enforces one fingerprint per watcher, so polling the same provider snapshot cannot repeatedly extend an investigation. A scan has its own persisted overlap lock and stale-lock recovery separate from normal watcher runs.

## Investigation and promotion

A qualified unknown company is created with every stock source enabled, `autoDiscovered=true`, an attention score, a reason, and an investigation timeout. A configured `DISCOVERY` name is promoted temporarily. Existing `WATCH` and `CORE` names may receive temporary high-resolution monitoring without losing their tier. Disabled companies are never automatically re-enabled.

The first targeted run checks all enabled sources. Subsequent high-resolution ticks check the fast, relevant subset: SEC, investor relations, GDELT news, TradingView news, and price. Normal and high-resolution executions share the same persisted run lock, source-health backoff, item/event deduplication, cooldowns, and analysis pipeline.

After every stock run, a canonical event first observed by that watcher with `HIGH` or `EXTREME` materiality promotes an investigated company to `WATCH/EVENT_MODE`. The event may already exist in the global cross-user event cache; per-watcher item-delivery deduplication prevents it from repeatedly renewing the same company. Event mode has a short timeout; afterward the company remains `WATCH/NORMAL`. If no such event appears before the investigation timeout, it returns to `DISCOVERY/LOW_RESOLUTION`.

An automatically promoted watch receives a configurable `watchUntil`. At expiry, a newer high/extreme event extends the reason and window. Without newer material evidence, it returns to discovery. This prevents automatic watchlists from growing indefinitely.

## Operations

`/discovery` shows whether the provider is configured, scan timestamps, active investigations, and recent signal decisions. `/run_discovery` triggers the same persisted coordinator used by the scheduler. `/stocks` labels auto-discovered names and displays their attention score and investigation deadline.

Important configuration is documented in `.env.example`. The defaults select at most ten candidates above a 4% move, $2 price, 100,000 current shares, and $1 million current dollar volume; investigate for 90 minutes; poll fast sources every five minutes; keep event mode for two hours; and keep an automatically promoted watch for fourteen days.

## Known limitations

- Alpha Vantage's `TOP_GAINERS_LOSERS` response is a bounded aggregate list, not a full exchange-by-exchange ticker dump.
- Real-time and delayed availability depends on the provider plan; the default is end-of-day.
- Relative volume, market-cap filtering, market-hours calendars, options, and unexplained-movement classification belong to Phase 4 or a future licensed market-data adapter.
- Phase 3 promotion is intentionally driven by Phase 2 canonical materiality. It does not yet create a thesis, recommendation, or trade action.
