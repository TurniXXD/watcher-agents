import { htmlText, optionalSourceLink } from '@watcher/telegram';
import { monthlyMortgagePayment } from './calculations.js';
import type {
  EvaluatedListing,
  InvestmentModel,
  RealityMetric,
  ReportPayload,
} from './types.js';

const number = (value: number | undefined, digits = 1): string =>
  value === undefined
    ? 'n/a'
    : new Intl.NumberFormat('cs-CZ', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(value);

const money = (value: number | undefined): string =>
  value === undefined
    ? 'n/a'
    : `${new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 }).format(value)} Kč`;

const latest = (
  metrics: readonly RealityMetric[],
  metric: string,
  location?: string,
  disposition?: string,
): RealityMetric | undefined =>
  metrics
    .filter(
      (item) =>
        item.metric === metric &&
        (location === undefined || item.location === location) &&
        (disposition === undefined || item.disposition === disposition),
    )
    .sort((left, right) => right.period.getTime() - left.period.getTime())[0];

const previous = (
  metrics: readonly RealityMetric[],
  current: RealityMetric | undefined,
  months: number,
): RealityMetric | undefined => {
  if (!current) return undefined;
  const target = new Date(
    Date.UTC(
      current.period.getUTCFullYear(),
      current.period.getUTCMonth() - months,
      1,
    ),
  );
  return metrics
    .filter(
      (item) =>
        item.metric === current.metric &&
        item.location === current.location &&
        item.disposition === current.disposition &&
        item.period <= target,
    )
    .sort((left, right) => right.period.getTime() - left.period.getTime())[0];
};

const changePercent = (
  current: RealityMetric | undefined,
  comparison: RealityMetric | undefined,
): number | undefined =>
  current && comparison && comparison.value !== 0
    ? ((current.value - comparison.value) * 100) / Math.abs(comparison.value)
    : undefined;

const absoluteChange = (
  current: RealityMetric | undefined,
  comparison: RealityMetric | undefined,
): number | undefined =>
  current && comparison ? current.value - comparison.value : undefined;

const trend = (change: number | undefined, inverse = false): string => {
  if (change === undefined || Math.abs(change) < 0.05) return '→';
  const up = change > 0;
  return inverse ? (up ? '↓' : '↑') : up ? '↑' : '↓';
};

const metricLine = (
  metrics: readonly RealityMetric[],
  key: string,
  label: string,
  suffix = '',
): string => {
  const current = latest(metrics, key);
  const mom = changePercent(current, previous(metrics, current, 1));
  return `• ${label}: ${number(current?.value, 2)}${suffix}${mom === undefined ? '' : ` (${mom >= 0 ? '+' : ''}${number(mom, 2)} % MoM)`}`;
};

const rateLine = (
  metrics: readonly RealityMetric[],
  key: string,
  label: string,
): string => {
  const current = latest(metrics, key);
  const delta = absoluteChange(current, previous(metrics, current, 1));
  return `• ${label}: ${number(current?.value, 2)} %${delta === undefined ? '' : ` (${delta >= 0 ? '+' : ''}${number(delta, 2)} p. b. MoM)`}`;
};

const listingLine = (listing: EvaluatedListing): string => {
  const economics = listing.economics;
  return [
    `<b>${htmlText(listing.location, 80)} ${htmlText(listing.disposition ?? '', 30)}</b> · score ${economics.score}/100`,
    optionalSourceLink(listing.title, listing.url, 350),
    `${money(listing.priceCzk)} · ${number(economics.pricePerM2Czk, 0)} Kč/m² · nájem ${money(listing.estimatedMonthlyRentCzk)}`,
    `Gross ${number(economics.grossYieldPercent, 2)} % · net ${number(economics.netYieldPercent, 2)} % · CF ${money(economics.cashflowCzk)}`,
    `Proti lokalitě ${number(economics.discountToLocalPercent, 1)} % · na trhu ${economics.daysOnMarket} dní${economics.priceReductionPercent ? ` · sleva ${number(economics.priceReductionPercent, 1)} %` : ''}`,
    `Stress: ${Object.entries(economics.stressCashflows)
      .map(([rate, cashflow]) => `${rate} ${money(cashflow)}`)
      .join(' · ')}`,
  ].join('\n');
};

const rawSummary = (metric: RealityMetric | undefined): string | undefined => {
  if (!metric || !metric.raw || typeof metric.raw !== 'object')
    return undefined;
  const summary = (metric.raw as Record<string, unknown>).summary;
  return typeof summary === 'string' ? summary : undefined;
};

const supplementalLines = (
  metrics: readonly RealityMetric[],
  category: RealityMetric['category'],
  excluded: ReadonlySet<string>,
): string[] => {
  const seen = new Set<string>();
  return [...metrics]
    .sort((left, right) => right.period.getTime() - left.period.getTime())
    .flatMap((metric) => {
      const key = `${metric.metric}\u0000${metric.location ?? ''}\u0000${metric.disposition ?? ''}`;
      if (
        metric.category !== category ||
        excluded.has(metric.metric) ||
        seen.has(key)
      )
        return [];
      seen.add(key);
      const label = metric.metric
        .toLocaleLowerCase('cs')
        .replaceAll('_', ' ')
        .replace(/^./u, (value) => value.toLocaleUpperCase('cs'));
      const context = [metric.location, metric.disposition]
        .filter(Boolean)
        .join(' · ');
      const summary = rawSummary(metric);
      return [
        `• ${htmlText(label, 100)}${context ? ` (${htmlText(context, 100)})` : ''}: ${number(metric.value, 2)} ${htmlText(metric.unit, 30)}${summary ? ` — ${htmlText(summary, 300)}` : ''}`,
      ];
    });
};

export const computeMarketScore = (
  metrics: readonly RealityMetric[],
  opportunities: readonly EvaluatedListing[],
): number => {
  let score = 50;
  const rate = latest(metrics, 'REALIZED_MORTGAGE_RATE');
  const price = latest(metrics, 'MEDIAN_ASK_PRICE_PER_M2');
  const rent = latest(metrics, 'RENT_PER_M2');
  const supply = latest(metrics, 'ACTIVE_LISTINGS');
  const rateChange = changePercent(rate, previous(metrics, rate, 1));
  const priceChange = changePercent(price, previous(metrics, price, 12));
  const rentChange = changePercent(rent, previous(metrics, rent, 12));
  const supplyChange = changePercent(supply, previous(metrics, supply, 12));
  if (rateChange !== undefined)
    score -= Math.max(-8, Math.min(8, rateChange * 2));
  if (priceChange !== undefined)
    score -= Math.max(-8, Math.min(8, priceChange / 2));
  if (rentChange !== undefined)
    score += Math.max(-8, Math.min(8, rentChange / 2));
  if (supplyChange !== undefined)
    score += Math.max(-5, Math.min(5, supplyChange / 3));
  if (opportunities.length)
    score += Math.max(
      -10,
      Math.min(15, opportunities[0]!.economics.score - 60),
    );
  return Math.round(Math.max(0, Math.min(100, score)));
};

export const renderRealityReport = (
  payload: ReportPayload,
  locations: readonly string[],
  model: InvestmentModel,
): string => {
  const { metrics, opportunities } = payload;
  const rate =
    latest(metrics, 'REALIZED_MORTGAGE_RATE') ??
    latest(metrics, 'OFFER_MORTGAGE_RATE');
  const price = latest(metrics, 'MEDIAN_ASK_PRICE_PER_M2');
  const rent = latest(metrics, 'RENT_PER_M2');
  const supply = latest(metrics, 'ACTIVE_LISTINGS');
  const rateMom = absoluteChange(rate, previous(metrics, rate, 1));
  const priceMom = changePercent(price, previous(metrics, price, 1));
  const rentMom = changePercent(rent, previous(metrics, rent, 1));
  const supplyMom = changePercent(supply, previous(metrics, supply, 1));
  const best = opportunities[0];
  const period = new Intl.DateTimeFormat('cs-CZ', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Prague',
  })
    .format(payload.generatedAt)
    .toLocaleUpperCase('cs');
  const citySummary = locations.map((location) => {
    const cityBest = opportunities.find((item) => item.location === location);
    if (!cityBest) return `<b>${htmlText(location, 80)}:</b> nedostatek dat`;
    const value = cityBest.economics;
    const label =
      (value.netYieldPercent ?? 0) >= 5 && value.cashflowCzk > 0
        ? 'atraktivní yield'
        : value.cashflowCzk < 0
          ? 'nízký cashflow'
          : 'neutrální';
    return `<b>${htmlText(location, 80)}:</b> ${label}`;
  });

  const cityDetails = locations.map((location) => {
    const cityPrice = latest(metrics, 'MEDIAN_ASK_PRICE_PER_M2', location);
    const cityRent = latest(metrics, 'RENT_PER_M2', location);
    const active = latest(metrics, 'ACTIVE_LISTINGS', location);
    const newListings = latest(metrics, 'NEW_LISTINGS', location);
    const days = latest(metrics, 'MEDIAN_DAYS_ON_MARKET', location);
    const reduced = latest(metrics, 'REDUCED_LISTINGS', location);
    const discount = latest(metrics, 'AVERAGE_DISCOUNT_PERCENT', location);
    const vacancy = latest(metrics, 'ESTIMATED_VACANCY_PERCENT', location);
    const gross =
      cityPrice && cityRent
        ? (cityRent.value * 12 * 100) / cityPrice.value
        : undefined;
    const dispositions = [
      ...new Set(
        metrics
          .filter(
            (metric) =>
              metric.location === location &&
              metric.disposition &&
              ['MEDIAN_ASK_PRICE_PER_M2', 'RENT_PER_M2'].includes(
                metric.metric,
              ),
          )
          .map((metric) => metric.disposition!),
      ),
    ].sort();
    const dispositionLine = dispositions.length
      ? `Dispozice: ${dispositions
          .map((disposition) => {
            const dispositionPrice = latest(
              metrics,
              'MEDIAN_ASK_PRICE_PER_M2',
              location,
              disposition,
            );
            const dispositionRent = latest(
              metrics,
              'RENT_PER_M2',
              location,
              disposition,
            );
            return `${disposition} ${number(dispositionPrice?.value, 0)} Kč/m² / nájem ${number(dispositionRent?.value, 0)} Kč/m²`;
          })
          .join(' · ')}`
      : 'Dispozice: n/a';
    return [
      `<b>${htmlText(location, 80)}</b>`,
      `Cena ${number(cityPrice?.value, 0)} Kč/m² · MoM ${number(changePercent(cityPrice, previous(metrics, cityPrice, 1)), 1)} % · YoY ${number(changePercent(cityPrice, previous(metrics, cityPrice, 12)), 1)} %`,
      `Nájem ${number(cityRent?.value, 0)} Kč/m² · gross yield ${number(gross, 2)} % · price/rent ${gross ? number(100 / gross, 1) : 'n/a'}× roční nájem`,
      dispositionLine,
      `Nabídky aktivní ${number(active?.value, 0)} · nové ${number(newListings?.value, 0)} · doba ${number(days?.value, 0)} dní`,
      `Zlevněné ${number(reduced?.value, 0)} · průměrná sleva ${number(discount?.value, 1)} % · odhad neobsazenosti ${number(vacancy?.value, 1)} %`,
    ].join('\n');
  });

  const macroPressure = latest(metrics, 'RATE_PRESSURE');
  const regulationLines = metrics
    .filter((metric) => metric.category === 'REGULATION')
    .sort((left, right) => right.period.getTime() - left.period.getTime())
    .slice(0, 10)
    .map(
      (metric) =>
        `• ${htmlText(rawSummary(metric) ?? metric.metric.replaceAll('_', ' '), 800)}${metric.sourceUrl ? ` — ${optionalSourceLink(metric.source, metric.sourceUrl, 100)}` : ` — ${htmlText(metric.source, 100)}`}`,
    );
  const development = [
    metricLine(metrics, 'BUILDING_PERMITS', 'Stavební povolení'),
    metricLine(metrics, 'DWELLINGS_STARTED', 'Zahájené byty'),
    metricLine(metrics, 'DWELLINGS_COMPLETED', 'Dokončené byty'),
  ];
  const demographic = [
    metricLine(metrics, 'POPULATION_CHANGE', 'Populace', ' %'),
    metricLine(metrics, 'NET_MIGRATION', 'Čistá migrace'),
    metricLine(metrics, 'LOCAL_WAGE_GROWTH', 'Mzdy v lokalitě', ' %'),
    metricLine(
      metrics,
      'LOCAL_UNEMPLOYMENT',
      'Nezaměstnanost v lokalitě',
      ' %',
    ),
  ];
  const developmentExtras = supplementalLines(
    metrics,
    'DEVELOPMENT',
    new Set(['BUILDING_PERMITS', 'DWELLINGS_STARTED', 'DWELLINGS_COMPLETED']),
  );
  const demographicExtras = supplementalLines(
    metrics,
    'DEMOGRAPHY',
    new Set([
      'POPULATION_CHANGE',
      'NET_MIGRATION',
      'LOCAL_WAGE_GROWTH',
      'LOCAL_UNEMPLOYMENT',
    ]),
  );
  const standardLoan = model.purchasePriceCzk * (1 - model.equityPercent / 100);
  const standardCashflowLines = locations.map((location) => {
    const rentPerM2 = latest(metrics, 'RENT_PER_M2', location);
    const typicalRent = latest(metrics, 'TYPICAL_MONTHLY_RENT', location);
    const monthlyRent =
      typicalRent?.value ??
      (rentPerM2 ? rentPerM2.value * model.floorAreaM2 : undefined);
    const monthlyCosts =
      (model.purchasePriceCzk * (model.annualMaintenancePercent / 100) +
        model.annualInsuranceCzk +
        model.otherAnnualOwnerCostsCzk) /
        12 +
      ((monthlyRent ?? 0) * model.vacancyPercent) / 100;
    const rates = [...new Set([3, rate?.value ?? 5, 5, 6, 7])].sort(
      (left, right) => left - right,
    );
    return `<b>${htmlText(location, 80)}</b>: nájem ${money(monthlyRent)} · ${rates
      .map((stressRate) => {
        const cashflow =
          (monthlyRent ?? 0) -
          monthlyMortgagePayment(standardLoan, stressRate, model.termYears) -
          monthlyCosts;
        return `${number(stressRate, 2)} % ${money(cashflow)}`;
      })
      .join(' · ')}`;
  });
  const missing = payload.sourceFailures.length
    ? `\n\n⚠️ <b>Nedostupné zdroje</b>\n${payload.sourceFailures
        .map(
          (failure) =>
            `• ${htmlText(failure.source, 80)}: ${htmlText(failure.error, 400)}`,
        )
        .join('\n')}`
    : '';

  return [
    `🏠 <b>REALITY MARKET — ${period}</b>`,
    [
      `Hypotéky: ${trend(rateMom)}`,
      `Ceny: ${trend(priceMom)}`,
      `Nájmy: ${trend(rentMom)}`,
      `Nabídka nemovitostí: ${trend(supplyMom)}`,
      `Dostupnost bydlení: ${trend((rateMom ?? 0) + (priceMom ?? 0), true)}`,
      '',
      ...citySummary,
      '',
      `<b>Market score: ${payload.marketScore}/100</b>`,
      `<b>Verdikt:</b> ${htmlText(payload.verdict, 700)}`,
      best
        ? `<b>Top opportunity:</b> ${htmlText(best.location, 80)} ${htmlText(best.disposition ?? '', 30)}, ${money(best.priceCzk)}, gross yield ${number(best.economics.grossYieldPercent, 2)} %.`
        : '<b>Top opportunity:</b> žádná nabídka s dostatečnými daty.',
      `<b>Co se změnilo:</b> sazby ${number(rateMom, 2)} p. b., ceny ${number(priceMom, 2)} %, nájmy ${number(rentMom, 2)} %, nabídka ${number(supplyMom, 2)} % MoM.`,
    ].join('\n'),
    [
      '💳 <b>Hypotéky a financování</b>',
      rateLine(metrics, 'REALIZED_MORTGAGE_RATE', 'Realizovaná sazba'),
      rateLine(metrics, 'OFFER_MORTGAGE_RATE', 'Nabídková sazba'),
      rateLine(metrics, 'CNB_REPO_RATE', 'Repo sazba ČNB'),
      rateLine(metrics, 'IRS_3Y', '3Y IRS'),
      rateLine(metrics, 'IRS_5Y', '5Y IRS'),
      rateLine(metrics, 'CZ_GOV_BOND_5Y', 'Český státní dluhopis 5Y'),
      rateLine(metrics, 'CZ_GOV_BOND_10Y', 'Český státní dluhopis 10Y'),
      `• Splátka na 1 mil. Kč / ${model.termYears} let: ${money(rate ? monthlyMortgagePayment(1_000_000, rate.value, model.termYears) : undefined)}`,
      `• Očekávání: ${htmlText(rawSummary(latest(metrics, 'RATE_OUTLOOK')) ?? 'n/a', 500)}`,
    ].join('\n'),
    [
      '📊 <b>Makro</b>',
      metricLine(metrics, 'INFLATION', 'Inflace', ' %'),
      metricLine(metrics, 'CORE_INFLATION', 'Jádrová inflace', ' %'),
      metricLine(metrics, 'WAGE_GROWTH', 'Růst mezd', ' %'),
      metricLine(metrics, 'UNEMPLOYMENT', 'Nezaměstnanost', ' %'),
      metricLine(metrics, 'GDP_GROWTH', 'HDP', ' %'),
      metricLine(metrics, 'CZK_EUR', 'Kurz CZK/EUR'),
      `• Prognóza ČNB: ${htmlText(rawSummary(latest(metrics, 'CNB_FORECAST')) ?? 'n/a', 500)}`,
      `• Tlak na sazby: ${macroPressure ? (macroPressure.value > 0.1 ? '↑' : macroPressure.value < -0.1 ? '↓' : '→') : 'n/a'}`,
    ].join('\n'),
    `🏙 <b>Ceny, nájmy a yield</b>\n\n${cityDetails.join('\n\n')}`,
    `🧮 <b>Hypotéka × nájem</b>\nModel ${money(model.purchasePriceCzk)} · equity ${number(model.equityPercent, 0)} % · ${model.termYears} let · ${number(model.floorAreaM2, 0)} m²\n${standardCashflowLines.join('\n')}`,
    [
      '🏗 <b>Development a nabídka</b>',
      ...development,
      ...developmentExtras,
      '',
      '👥 <b>Demografie a ekonomika lokalit</b>',
      ...demographic,
      ...demographicExtras,
    ].join('\n'),
    `⚖️ <b>Regulace a daně</b>\n${regulationLines.length ? regulationLines.join('\n') : 'Bez zaznamenané významné změny; ověřte úplnost zdroje.'}`,
    `🏆 <b>TOP investiční nabídky</b>\n\n${opportunities.length ? opportunities.slice(0, 10).map(listingLine).join('\n\n') : 'Žádná aktivní nabídka nemá dost dat pro výpočet.'}${missing}`,
  ].join('\n\n');
};

export const renderOpportunityAlert = (listing: EvaluatedListing): string =>
  `🚨 <b>REALITY OPPORTUNITY</b>\n\n${listingLine(listing)}`;
