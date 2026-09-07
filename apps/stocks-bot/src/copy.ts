const scheduleExample =
  '/schedule 0 7 * * 1-5; 30 8 * * 1-5; 0 20 * * 1-5 America/New_York';

export const stocksHelp = `/about — what the stocks bot does and how to use it
/add_stock SYMBOL — add a stock using the global source settings
/advanced [SYMBOL] — latest options, institutional, short-interest, FDA, and trial data
/alerts — recently generated live alerts
/backtest — return/hit-rate/MFE/MAE validation report
/calibration — predicted vs realized 30-day probability buckets
/catalysts [SYMBOL] — list active and upcoming catalysts
/dashboard — current state of every enabled stock
/discovery — discovery scanner status and recent candidates
/event_replay SYMBOL [FROM] [TO] — replay events and thesis transitions
/health — runs, reconciliation, LLM metrics, and source health
/help — show this command list
/list_sources — list available sources and provider links
/opportunities — stocks with elevated attention or favorable asymmetry
/pause — pause scheduled runs
/reconcile — run the comprehensive daily reconciliation now
/remove_stock SYMBOL — remove a stock
/replay SYMBOL DATE — reconstruct only information known by that date
/resume — resume scheduled runs
/run — run now
/run_discovery — run the cheap market-wide discovery scan now
/schedule [CRON[; CRON...]] [TIMEZONE] — view or update schedule
  Example: ${scheduleExample}
/set_mode SYMBOL MODE — set LOW_RESOLUTION/NORMAL/HIGH_RESOLUTION/EVENT_MODE
/set_priority SYMBOL 0-100 — set monitoring priority
/set_tier SYMBOL TIER [YYYY-MM-DD] [REASON] — set CORE/WATCH/DISCOVERY/INVESTIGATE
/signal_performance — empirical 30-day result by signal type
/sources — configure all stock data sources
/start — initialize the bot and show this command list
/status — watcher status
/stock_off SYMBOL — disable monitoring for a stock
/stock_on SYMBOL — enable monitoring for a stock
/stocks — list stocks
/thesis SYMBOL — show the latest persistent thesis and scores
/validate — backtest stored theses, alerts, and signals against stored prices`;

export const stocksAbout = `*Stocks Watcher*

Stocks Watcher is a private, self-hosted Telegram research assistant for monitoring a configurable stock universe. It gathers evidence from regulatory filings, issuer feeds, news, market data, analyst snapshots, insider activity, options, institutional holdings, short interest, clinical trials, and FDA records when those sources are available.

*What it does*
• Normalizes source data into durable observations and prevents duplicate delivery.
• Groups related evidence into canonical company events and scores materiality before using the LLM.
• Uses Ollama to analyze meaningful events and maintain a persistent company thesis with bull, bear, risk, catalyst, confidence, coverage, and decision context.
• Applies event and ticker cooldowns so repeated evidence does not create alert noise or waste analysis capacity.
• Produces live alerts, dashboards, opportunity views, event replay, historical as-of replay, and outcome validation.
• Runs the same resilient pipeline for manual runs, scheduled monitoring, discovery, and reconciliation. One failing source does not cancel successful sources.

*Key advantages*
• Private by design: Telegram is the administration surface, PostgreSQL stores state, and Ollama remains under your control.
• Evidence-first: sourced facts are separated from inference, and missing data reduces confidence instead of becoming neutral evidence.
• Cost-aware: deterministic filters, deduplication, cached analysis, and cooldowns reduce unnecessary LLM work.
• Transparent: digests report coverage, source failures, analysis failures, and processing decisions.
• Durable: schedules, observations, theses, alerts, source health, and validation results survive restarts.

*How to use it*
1. Add a company with \`/add_stock SYMBOL\`, then review it with \`/stocks\`.
2. Use \`/sources\` to enable or disable providers globally for every current and future stock, and \`/list_sources\` to see what every provider contributes.
3. Run \`/run\` for an immediate check, or configure recurring monitoring with \`/schedule CRON TIMEZONE\`. Separate multiple cron expressions with semicolons when you want several daily checks.
4. Read \`/dashboard\`, \`/thesis SYMBOL\`, \`/catalysts\`, \`/alerts\`, and \`/opportunities\` for the current decision picture.
5. Use \`/health\` when diagnosing coverage or model issues, and \`/replay\`, \`/event_replay\`, \`/validate\`, and \`/backtest\` to audit historical behavior.
6. Use \`/pause\` and \`/resume\` to control scheduled runs without deleting configuration.

_Important:_ The bot supports research and monitoring. Its outputs are not financial advice or automatic trade instructions; review primary evidence and make your own decisions.`;

export { scheduleExample };
