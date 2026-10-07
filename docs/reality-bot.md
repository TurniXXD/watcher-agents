# Reality Bot sources and calculation policy

Reality Bot collects current apartment sale and rental offers directly from
DigiReality's public RSS channel. The provider explicitly permits personal,
non-commercial use and publishes anonymous and keyed request limits:

- data documentation: <https://www.digireality.cz/pages/dokumentace-api>
- terms of data use: <https://www.digireality.cz/pages/podminky-uziti-dat>

The bot does not call or imitate private browser APIs, defeat bot protection,
rotate identities, or download listing photographs. Commercial use and
systematic extraction beyond the public allowance require a key from the
provider.

## Listing collection

For each watched city the adapter discovers the RSS links exposed by the public
sale-flat and rental-flat result pages. It fetches only page 1, which contains
up to 50 of the most recently updated active offers. Results are cached for 55
minutes, so the default 30-minute monitor remains below the documented
anonymous quota for the three default cities.

`REALITY_DIGIREALITY_KEY` is optional. When set, it is added as the documented
HTTPS `key` query parameter. It is never sent to another host or written to
logs.

The following values are parsed from each RSS item:

- stable RSS GUID and public detail URL;
- title and update/publication time;
- numeric CZK price from the explicit `Cena:` field;
- usable area expressed as `m²` or `m2`;
- disposition such as `1+kk`, `2+kk`, or `2+1` when present.

Offers with a hidden/non-numeric price or without a usable floor area are
discarded. No substitute value is invented. RSS page 1 is a recent sample, not
the complete active inventory, so the bot does not mark older stored offers as
withdrawn merely because they disappear from that page.

## Derived city metrics

For every city, the current sample produces:

- `MEDIAN_ASK_PRICE_PER_M2` from sale offers;
- `RENT_PER_M2` from rental offers;
- the same metrics by disposition where the sample contains that disposition.

The metric `raw` metadata records the sample size and identifies the sample as
the latest RSS page. A sale listing receives an estimated monthly rent from the
same-city, same-disposition rental median, falling back to the city-wide rental
median. Its local comparison price is derived in the same way from sale offers.

These values are asking-price indicators from a recent sample. They are not
transaction prices, valuations, or a claim to cover the whole market.

## Calculation policy

Gross yield is annual estimated rent divided by purchase price. Net yield
applies configured vacancy, supplied owner costs, maintenance, insurance, and
other owner costs, then divides by purchase price plus supplied acquisition
costs. Cashflow is monthly rent minus the annuity mortgage payment and monthly
operating-cost reserve.

The investment score is deterministic and bounded to 0–100. It combines gross
yield, net yield, discount to the local sample median, stress cashflow, observed
price reduction, and time on market. It is a ranking aid, not a valuation or
recommendation.

The immediate alert requires all three conditions: gross yield at least 6%,
price per square metre at least 15% below the local sample median, and positive
cashflow at a 5% mortgage rate. An alert signature includes price, rent estimate,
and stress rate, preventing duplicates while allowing a materially repriced
listing to alert again.

Financing, macroeconomic, development, demographic, and regulatory sections
remain explicitly unavailable until first-party adapters for their authoritative
sources are added. The bot never fills those sections with fabricated values.
