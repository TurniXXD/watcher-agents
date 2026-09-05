# Stock Intelligence Phase 4

Phase 4 adds specialized, deterministic stock signals before the later thesis and decision layers. It does not generate recommendations.

## Insider intelligence

SEC Form 4 XML, FINVIZ insider rows, and Quiver insider rows are normalized into the same fact keys. The classifier records the insider and role, transaction date, shares, price, calculated value, holdings before/after, signed holdings change, planned/discretionary status, and one of:

- `OPEN_MARKET_BUY`
- `OPEN_MARKET_SELL`
- `10B5_1_SALE`
- `TAX_SELL_TO_COVER`
- `OPTION_EXERCISE`
- `RSU_VESTING`
- `GIFT`
- `OTHER`

Conviction is bounded to `-5..+5`. Open-market purchases receive positive weight based on role, size, and holdings change. Discretionary sales receive limited negative weight; planned, tax, compensation, exercise, and gift transactions stay low-conviction context. Three distinct open-market buyers within 30 days create a purchase-cluster signal. Every rationale explicitly avoids inferring illegal knowledge or intent.

The specialized fingerprint uses ticker, insider, date, transaction type, shares, and price. Matching SEC, FINVIZ, and Quiver observations therefore converge on one canonical event. Existing evidence priority keeps SEC as primary evidence when it is available.

## Catalyst registry

Earnings, guidance, trials, FDA decisions, launches, contracts, legal/regulatory decisions, and related events can create persistent catalyst rows. Each row stores the ticker, type, description, exact date or date range, proximity, impact, direction, status, and canonical-event evidence. `/catalysts [SYMBOL]` lists active/upcoming records and links their primary evidence.

Dates remain unknown when the source does not supply one. The implementation does not invent a calendar date from vague language.

## Market anomalies and unexplained movement

Each valid price observation is stored as a market snapshot. When sufficient history is available, the deterministic engine calculates daily, weekly, monthly, and 90-day returns; relative volume; opening gap; ATR; realized volatility; 20-session moving-average distance; RSI; and optional pre-market, after-hours, sector-relative, and index-relative values when an adapter supplies them.

Configured thresholds detect price, gap, relative-volume, and volatility-expansion anomalies. An anomaly has `UNKNOWN` direction and is stored without an Ollama call. It is associated with a material event in the surrounding 24-hour window when evidence exists. Otherwise it stays `cause=UNKNOWN`, raises attention, and moves a discovery name into a temporary high-resolution investigation. No leak or insider-trading claim is made.

Off-exchange DPI is stored independently. It becomes an attention-only anomaly after at least five baseline points and a 1.5× baseline ratio. It is not treated as directional evidence.

## Quiver integration

`QUIVER_API_TOKEN` enables optional bearer-authenticated adapters for:

- insider transactions;
- government contracts;
- corporate patents;
- congressional transactions;
- off-exchange activity.

All five source switches are created enabled for each stock, but no Quiver requests are scheduled when the server token is absent. Responses are validated with Zod at the HTTP boundary. The token is used only in the authorization header and is never placed in URLs, items, logs, or Telegram configuration.

Polling metadata distinguishes event-oriented datasets from daily off-exchange snapshots. Actual request frequency is also constrained by the existing source-health/backoff layer and the user's Quiver subscription. Review the current [Quiver API documentation](https://api.quiverquant.com/docs/) and [terms](https://www.quiverquant.com/termsofservice/) before enabling production collection or redistribution.

## Cost and lifecycle behavior

- Routine insider, patent, congressional, off-exchange, and market-state observations do not spend an LLM slot.
- A genuinely strong discretionary insider signal may pass the existing materiality/cooldown gate for targeted analysis.
- Price and alternative-data anomalies increase attention; they do not directly promote a company to `WATCH`.
- Independent high/extreme company events continue to drive `WATCH/EVENT_MODE` promotion.

## Deferred provider coverage

Options, institutional positioning/top-shareholder feeds, short interest, licensed real-time pre/post-market prices, sector benchmarks, and forward-return backtesting remain Phase 8/9 work. The schema and normalized event types leave room for those additions without inventing unavailable data in Phase 4.
