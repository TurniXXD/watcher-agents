# Reality Bot

Private Czech real-estate monitoring and investment-analysis Telegram service. It produces periodic market reports and alerts only when listings satisfy persisted yield, discount, and cashflow gates.

The calculator models purchase price, equity, mortgage term/rate, vacancy, maintenance, insurance, yields, annuity payments, and stress cashflows. Listing history makes discounts and time-on-market observed values rather than guesses. DigiReality RSS is cached, photographs are not downloaded, and malformed listings are dropped instead of repaired with invented values.

## Commands

Use `/start`, `/help`, `/about`, `/status`, `/run`, `/pause`, `/resume`, `/schedule`, `/locations`, `/location_add`, `/location_remove`, and `/model`.

## Configuration

Use [the reality preset](../../deploy/presets/reality-bot.env.example). `REALITY_DIGIREALITY_KEY` is optional. The service also needs the database, a distinct Telegram token, allowlist, timezone, schedule, locations, and monitoring interval.

See [the source and calculation policy](../../docs/reality-bot.md).
