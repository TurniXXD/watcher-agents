# Stock Intelligence Phase 8

Phase 8 adds advanced positioning, regulatory, and alternative datasets to the existing event-driven stock pipeline. Every result is normalized into the shared observation contract and passes through PostgreSQL deduplication before it can affect a canonical event, thesis, or alert.

## Sources

- Alpha Vantage `INSTITUTIONAL_HOLDINGS` supplies periodic institutional positioning. It is instantiated only when `ALPHA_VANTAGE_API_KEY` is configured.
- Alpha Vantage `REALTIME_OPTIONS` supplies an option chain with Greeks. It is instantiated only when the API key is configured and `ALPHA_VANTAGE_OPTIONS_ENABLED=true`; this endpoint requires a premium entitlement.
- FINRA consolidated short interest supplies official reported short position, period change, average daily volume, and days to cover.
- ClinicalTrials.gov v2 supplies studies where the resolved company name appears as a lead sponsor or collaborator.
- openFDA Drugs@FDA supplies sponsor-matched drug application submission statuses.
- Quiver lobbying adds one more secondary alternative-data feed when `QUIVER_API_TOKEN` is configured.

All six source switches are enabled for a newly added stock. Credential-backed switches are dormant when their credential or explicit entitlement flag is absent, and dormant sources are excluded from data-coverage calculations.

## Structured signals and safeguards

Options, institutional, and short-interest observations are stored in dedicated time-series tables. Deterministic anomaly checks run before Ollama:

- options activity requires either a contract volume/open-interest ratio above `OPTIONS_VOLUME_OI_ANOMALY_THRESHOLD` or aggregate volume above `OPTIONS_VOLUME_BASELINE_MULTIPLIER` times a sufficiently populated recent baseline;
- institutional activity requires an absolute reported holdings change of at least `INSTITUTIONAL_CHANGE_THRESHOLD_PERCENT`;
- short interest requires either an absolute period change of at least `SHORT_INTEREST_CHANGE_THRESHOLD_PERCENT` or days to cover at least `SHORT_INTEREST_DAYS_TO_COVER_THRESHOLD`.

Options and short-interest anomalies stay direction `UNKNOWN`. Their event reasons explicitly state that activity does not establish informed trading or future price direction. Institutional reports preserve their reported sign but note that filings are delayed and do not reveal current intent. Non-anomalous snapshots remain persisted context and do not consume an Ollama analysis slot.

Clinical-trial identity includes the NCT identifier and public update date, so a changed trial can be observed again while an unchanged record remains deduplicated. FDA identity includes the application, submission, date, and status. Existing processed-item, canonical-event, cooldown, and delivery constraints continue to prevent duplicate processing and alerts.

## Operational limits

- Company legal names do not always match FDA sponsor or ClinicalTrials organization names. The source is therefore useful only when the resolved SEC company name matches the regulatory record closely enough; unmatched records are treated as missing data, not neutral evidence.
- Alpha Vantage and Quiver access depends on the operator's current provider plan. Provider entitlement failures are isolated as source failures and enter the existing bounded backoff.
- FINRA short interest and institutional reports are delayed disclosures. They are contextual signals, not live positioning.
- No source in this phase places trades or turns a single alternative-data observation into a buy or sell instruction.
