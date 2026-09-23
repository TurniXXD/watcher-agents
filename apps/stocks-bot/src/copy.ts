const scheduleExample =
  '/schedule 0 7 * * 1-5; 30 8 * * 1-5; 0 20 * * 1-5 America/New_York';

export const stocksHelp = `/about — český průvodce používáním a strategiemi sledování
/add_stock SYMBOL — add a stock using the global source settings
/advanced [SYMBOL] — latest options, institutional, short-interest, FDA, and trial data
/alerts — recently generated live alerts
/allocation [--amount-czk AMOUNT] [--days DAYS] — rank stored research and optionally calculate a Czech-koruna research allocation
/alpaca — read-only Alpaca Paper account, positions, and last five orders
/backtest — return/hit-rate/MFE/MAE validation report
/calibration — predicted vs realized 30-day probability buckets
/catalysts [SYMBOL] — list active and upcoming catalysts
/dashboard — current state of every enabled stock
/decision SYMBOL — show the latest evidence-linked research decision card
/discovery — discovery scanner status and recent candidates
/earnings SYMBOL — show the stored earnings setup and the latest expectation-versus-actual comparison
/event_replay SYMBOL [FROM] [TO] — replay events and thesis transitions
/health — runs, reconciliation, LLM metrics, and source health
/help — show this command list
/list_sources — list available sources and provider links
/news SYMBOL RANGE [--json] — saved stock news by publication time; JSON exports full stored details
/opportunities — stocks with elevated attention or favorable asymmetry
/paper_close NUMBER — close an open paper position at the latest stored price
/paper_open SYMBOL --amount-czk AMOUNT [--days DAYS] — record a no-execution paper position using the latest stored price
/paper_portfolio — show open and closed paper positions and their stored-price outcomes
/pause — pause scheduled runs
/peers SYMBOL — show the curated peer and sector context map for supported AI-infrastructure stocks
/portfolio_risk — audit paper-position concentration, sector overlap, stale prices, and research coverage
/reaction SYMBOL — check whether stored post-event price data confirms, contradicts, or cannot yet explain the latest material driver
/reconcile — run the comprehensive daily reconciliation now
/remove_stock SYMBOL — remove a stock
/replay SYMBOL DATE — reconstruct only information known by that date
/reset_stocks CONFIRM — remove every stock from this watchlist; historical research is retained
/resume — resume scheduled runs
/risk_profile [PROFILE] [--max-position PERCENT] [--max-sector PERCENT] [--max-total-czk AMOUNT|none] — view or set paper-portfolio warning limits
/run — run now
/run_discovery — run the market-wide discovery report now; it never changes your watchlist
/schedule [CRON[; CRON...]] [TIMEZONE] — view or replace all schedules
/schedule_add CRON — add one schedule without replacing the others
/schedule_list — list numbered schedules, timezone, and next run
/schedule_remove NUMBER — remove a schedule by its list number
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
/stocks_tickers — list only enabled ticker symbols
/thesis SYMBOL — refresh live sources for one ticker, then show its updated persistent thesis and scores
/validate — backtest stored theses, alerts, and signals against stored prices
/valuation SYMBOL — show stored price, provider forward P/E, market cap, and earnings consensus`;

export const stocksAboutPages = [
  `*Stocks Watcher · průvodce 1/3*

Soukromý pomocník pro sledování akcií. Sbírá zprávy, firemní oznámení, podání SEC a další dostupná data, propojuje související události a s pomocí Ollamy vytváří průběžnou výzkumnou tezi. Neobchoduje za vás.

*Začněte za minutu*
1. \`/add_stock MU\` přidá firmu do vašeho seznamu. \`/stocks\` ukáže, co sledujete; seznam je na začátku prázdný.
2. \`/thesis MU\` načte živé zdroje jen pro MU a zkusí sestavit nebo aktualizovat tezi. Když už běží jiná kontrola, příkaz počká a průběžně ukazuje stav. \`/run\` naopak spustí kontrolu celého seznamu.
3. \`/dashboard\` dá rychlý přehled, \`/alerts\` nové důležité události a \`/catalysts MU\` blížící se katalyzátory.

*Jak číst tezi*
\`/thesis MU\` ukazuje hlavní důvody pro a proti, rizika, scénáře růstu/základu/poklesu, jistotu analýzy a pokrytí dat. Skóre není pravděpodobnost výnosu. \`/decision MU\` je výzkumná karta, ne pokyn k nákupu. Ověřujte původní zdroje a datum údajů.

*Když teze ještě není*
„THESIS NOT READY“ znamená, že chybí úspěšně analyzovaná použitelná událost. Další čekání samo o sobě nic nezaručí. Zkontrolujte \`/health\` (zdroje a model), potom lze \`/thesis MU\` zopakovat. Bot nesmí vymýšlet závěr ze starých dat.`,
  `*Stocks Watcher · průvodce 2/3*

*Jakou zvolit strategii sledování?*
Každá akcie má „tier“ (jak důležitá je pro sledování) a „mode“ (intenzita kontrol). Nově přidaná akcie začíná jako \`WATCH\` + \`NORMAL\`.

• \`CORE\` — vaše hlavní dlouhodobě sledované firmy.
• \`WATCH\` — běžný seznam firem, které chcete mít pod dohledem.
• \`DISCOVERY\` — předběžné nápady s úspornějším sledováním; při ručním nastavení se zapne \`LOW_RESOLUTION\`.
• \`INVESTIGATE\` — firma, kterou chcete dočasně prověřit podrobněji.

Změna: \`/set_tier MU CORE\`. U vyšetřování lze přidat datum a důvod: \`/set_tier MU INVESTIGATE 2026-12-31 výsledky\`.

Režimy: \`LOW_RESOLUTION\` šetří kontroly, \`NORMAL\` je výchozí, \`HIGH_RESOLUTION\` kontroluje častěji a \`EVENT_MODE\` zintenzivní sledování kolem události. Například \`/set_mode MU HIGH_RESOLUTION\`. Skutečné intervaly omezují také zdroje a jejich limity; častější režim neznamená více použitelných zpráv.

\`/set_priority MU 80\` uloží prioritu 0–100. \`/stock_off MU\` sledování vypne bez odstranění firmy, \`/stock_on MU\` jej obnoví. \`/remove_stock MU\` firmu odstraní ze seznamu.`,
  `*Stocks Watcher · průvodce 3/3*

*Tři praktické postupy*
• *Dlouhodobý přehled:* přidejte firmu, označte ji \`CORE\`, sledujte \`/dashboard\`, \`/earnings MU\`, \`/valuation MU\` a změny teze. Cena nebo násobek ocenění samy o sobě nejsou verdikt.
• *Události a katalyzátory:* použijte \`/catalysts MU\`, \`/alerts\`, \`/news MU 7d\` a \`/event_replay MU\`. \`/reaction MU\` rozlišuje pozorovaný pohyb ceny od prokázané reakce na událost.
• *Hledání nápadů:* \`/opportunities\` ukáže zvýšenou pozornost nebo zajímavou asymetrii. Volitelný \`/run_discovery\` vyžaduje nakonfigurovaný zdroj a nic sám nepřidá; vybranou firmu přidejte ručně.

*Zdroje a časování*
Novinky pro sledované akcie se běžně kontrolují po 5 minutách; plán určuje samostatné úplné běhy. \`/sources\` mění zdroje pro všechny současné i budoucí akcie; \`/list_sources\` vysvětlí, odkud data pocházejí. \`/schedule_list\` ukáže plán, \`/schedule_add 0 8 * * *\` přidá denní běh v nastaveném časovém pásmu. \`/pause\` a \`/resume\` pozastaví či obnoví plánované běhy.

*Zkoušení bez obchodu*
\`/paper_open MU --amount-czk 10000\` zaznamená modelovou pozici bez odeslání pokynu. \`/paper_portfolio\` ukáže vývoj podle uložených cen; \`/portfolio_risk\` upozorní na koncentraci a stará data. Například \`/risk_profile balanced\` (nebo \`conservative\` či \`aggressive\`) mění jen hranice těchto varování, nikoli strategii teze nebo skutečný účet. \`/validate\` a \`/backtest\` porovnají starší výstupy s dostupnými výsledky.

_Výstupy jsou podklady k vlastnímu rozhodnutí, nikoli investiční doporučení. Žádný z těchto příkazů neposílá obchod._ Další příkazy: \`/help\`.`,
] as const;

export { scheduleExample };
