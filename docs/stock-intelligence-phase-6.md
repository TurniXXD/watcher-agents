# Stock Intelligence Phase 6

Phase 6 adds a bounded decision-support layer after full thesis analysis: bull/base/bear scenarios, probability ranges, expected value, asymmetry, priced-in classification, recommendations, and conservative maximum position ranges.

## Model versus deterministic logic

Ollama supplies structured scenario inputs: broad probability and return ranges, assumptions, required catalysts, invalidation conditions, supported probability horizons, priced-in evidence, volatility risk, binary-catalyst exposure, and downside reasoning. Runtime schemas reject inverted ranges, probabilities outside `0–100%`, positive bear cases, and implausible scenario distributions.

Application code then:

- calculates scenario-weighted expected return independently from probability of profit;
- classifies asymmetry from expected value relative to bear-case downside;
- gates recommendations on coverage, confidence, net signal, expected value, and priced-in status;
- reduces maximum size for low confidence/coverage, high or unknown volatility, binary catalysts, and severe downside;
- always marks the result for human review.

If coverage is below `50%`, confidence below `45%`, or no supported probability horizon exists, the result is `INSUFFICIENT_DATA`, expected value is omitted, and maximum suggested size is `0%`.

The engine does not know the operator's holdings, liquidity needs, portfolio concentration, or risk tolerance. It therefore does not emit `HOLD`/`SELL` based on assumed ownership and caps non-zero research sizing at a small single-digit percentage. Output is research support, not automatic trading.

## Persistence and output

The decision result is embedded in `CompanyThesisState` and every `ThesisRevision`. `/thesis SYMBOL` and run digests show the recommendation, expected value, asymmetry, probability ranges, priced-in status, maximum suggested position range, and the mandatory human-review notice.
