# Stocks Bot

Private Telegram watcher for company filings, issuer news, market observations, catalysts, watchlist earnings, thesis changes, alerts, portfolio context, discovery, replay, and paper workflows.

The watchlist starts empty. Sources normalize observations before canonical event deduplication, materiality evaluation, bounded Ollama analysis, thesis updates, and Telegram delivery. High/extreme failures remain visible and retryable; provider evidence never becomes automatic investment advice.

Primary sources include SEC EDGAR, issuer feeds, TradingView, FINVIZ, Zacks, Earnings Whispers, Nasdaq, FINRA, ClinicalTrials.gov, openFDA, optional Alpha Vantage, and optional Quiver datasets.

## Commands

Important commands include `/stocks`, `/add_stock`, `/remove_stock`, `/run`, `/sources`, `/schedule`, `/thesis`, `/valuation`, `/earnings`, `/catalysts`, `/dashboard`, `/opportunities`, `/alerts`, `/health`, `/discovery`, `/reconcile`, `/backtest`, `/calibration`, `/replay`, and the paper/portfolio commands.

## Configuration

Start from [the stocks preset](../../deploy/presets/stocks-bot.env.example). Required values include the database, Telegram token/allowlist, Ollama connection, and an identifiable `SEC_USER_AGENT`. Alpha Vantage, Quiver, Alpaca Paper, and Trading 212 credentials are optional and activate only their owning integration.

Core thesis coverage does not require paid options data. When `ALPHA_VANTAGE_OPTIONS_ENABLED=false`, `OPTIONS_POSITIONING` is marked `NOT_APPLICABLE`, excluded from the core coverage denominator, and is not reported as a material data gap. When the options integration is explicitly enabled but unhealthy, it is reported as unavailable. A manual `/thesis SYMBOL` also forces one new full analysis from the best unreviewed evidence when the stored verdict is `INSUFFICIENT_DATA`, so a stale verdict can recover without enabling Alpha Vantage.

## Detailed design

- [Hybrid stock events](../../docs/stock-hybrid-events.md)
- [Phase 1](../../docs/stock-intelligence-phase-1.md) through [Phase 9](../../docs/stock-intelligence-phase-9.md)

## Development

```bash
pnpm --filter @watcher/stocks-bot typecheck
pnpm exec vitest run apps/stocks-bot/src/__tests__
```
