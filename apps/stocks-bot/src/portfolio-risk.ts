import { htmlText } from '@watcher/telegram';
import type { PaperPositionView } from '@watcher/database';

type DashboardRiskContext = {
  stock: { symbol: string; sector?: string | null };
  thesis: {
    confidence: number;
    dataCoverage: number;
  } | null;
};

type RiskLevel = 'HIGH' | 'MEDIUM';

export type PortfolioRiskSnapshot = {
  totalNotionalCzk: number;
  openPositionCount: number;
  tickerCount: number;
  concentrationHhi: number;
  positions: {
    ticker: string;
    amountCzk: number;
    weightPercent: number;
    sector: string | null;
    marketDataAgeHours: number | null;
    horizonElapsed: boolean;
    thesisConfidence: number | null;
    dataCoverage: number | null;
  }[];
  sectorConcentration: { sector: string; weightPercent: number }[];
  warnings: { level: RiskLevel; message: string }[];
};

const marketDataAgeHours = (
  positions: PaperPositionView[],
  now: Date,
): number | null => {
  const observed = positions
    .map(
      ({ latestPriceObservedAt, entryPriceObservedAt }) =>
        latestPriceObservedAt ?? entryPriceObservedAt,
    )
    .sort((left, right) => right.getTime() - left.getTime())[0];
  return observed
    ? Math.max(0, (now.getTime() - observed.getTime()) / 3_600_000)
    : null;
};

export const assessPortfolioRisk = (
  paperPositions: PaperPositionView[],
  dashboard: DashboardRiskContext[],
  now = new Date(),
): PortfolioRiskSnapshot => {
  const open = paperPositions.filter(({ status }) => status === 'OPEN');
  const byTicker = new Map<string, PaperPositionView[]>();
  for (const position of open) {
    const current = byTicker.get(position.ticker) ?? [];
    current.push(position);
    byTicker.set(position.ticker, current);
  }
  const totalNotionalCzk = open.reduce(
    (total, position) => total + position.amountCzk,
    0,
  );
  const dashboardByTicker = new Map(
    dashboard.map((entry) => [entry.stock.symbol, entry]),
  );
  const positions = [...byTicker.entries()]
    .map(([ticker, entries]) => {
      const amountCzk = entries.reduce(
        (total, position) => total + position.amountCzk,
        0,
      );
      const context = dashboardByTicker.get(ticker);
      return {
        ticker,
        amountCzk,
        weightPercent:
          totalNotionalCzk === 0 ? 0 : (amountCzk / totalNotionalCzk) * 100,
        sector: context?.stock.sector?.trim() || null,
        marketDataAgeHours: marketDataAgeHours(entries, now),
        horizonElapsed: entries.some(({ horizonElapsed }) => horizonElapsed),
        thesisConfidence: context?.thesis?.confidence ?? null,
        dataCoverage: context?.thesis?.dataCoverage ?? null,
      };
    })
    .sort(
      (left, right) =>
        right.weightPercent - left.weightPercent ||
        left.ticker.localeCompare(right.ticker),
    );
  const concentrationHhi = positions.reduce(
    (total, position) =>
      total + (position.weightPercent / 100) * (position.weightPercent / 100),
    0,
  );
  const sectorTotals = new Map<string, number>();
  for (const position of positions) {
    const sector = position.sector ?? 'Unclassified';
    sectorTotals.set(
      sector,
      (sectorTotals.get(sector) ?? 0) + position.amountCzk,
    );
  }
  const sectorConcentration = [...sectorTotals.entries()]
    .map(([sector, amountCzk]) => ({
      sector,
      weightPercent:
        totalNotionalCzk === 0 ? 0 : (amountCzk / totalNotionalCzk) * 100,
    }))
    .sort((left, right) => right.weightPercent - left.weightPercent);
  const warnings: PortfolioRiskSnapshot['warnings'] = [];
  for (const position of positions) {
    if (position.weightPercent >= 25) {
      warnings.push({
        level: 'HIGH',
        message: `${position.ticker} is ${position.weightPercent.toFixed(0)}% of open paper notional.`,
      });
    } else if (position.weightPercent >= 15) {
      warnings.push({
        level: 'MEDIUM',
        message: `${position.ticker} is ${position.weightPercent.toFixed(0)}% of open paper notional.`,
      });
    }
    if (
      position.thesisConfidence === null ||
      position.dataCoverage === null ||
      position.thesisConfidence < 0.45 ||
      position.dataCoverage < 50
    ) {
      warnings.push({
        level: 'MEDIUM',
        message: `${position.ticker} has incomplete current research coverage or confidence.`,
      });
    }
    if (
      position.marketDataAgeHours === null ||
      position.marketDataAgeHours > 36
    ) {
      warnings.push({
        level: 'MEDIUM',
        message: `${position.ticker} has no recent stored market price (over 36 hours old or missing).`,
      });
    }
    if (position.horizonElapsed) {
      warnings.push({
        level: 'MEDIUM',
        message: `${position.ticker} has reached its declared paper horizon and needs reassessment.`,
      });
    }
  }
  for (const sector of sectorConcentration) {
    if (sector.weightPercent >= 50) {
      warnings.push({
        level: 'HIGH',
        message: `${sector.sector} represents ${sector.weightPercent.toFixed(0)}% of open paper notional.`,
      });
    }
  }
  if (concentrationHhi >= 0.25 && positions.length > 1) {
    warnings.push({
      level: concentrationHhi >= 0.5 ? 'HIGH' : 'MEDIUM',
      message: `Position concentration is elevated (HHI ${concentrationHhi.toFixed(2)}).`,
    });
  }
  return {
    totalNotionalCzk,
    openPositionCount: open.length,
    tickerCount: positions.length,
    concentrationHhi,
    positions,
    sectorConcentration,
    warnings,
  };
};

const formatCzk = (amount: number): string =>
  `${new Intl.NumberFormat('cs-CZ').format(Math.round(amount))} Kč`;

export const renderPortfolioRisk = (risk: PortfolioRiskSnapshot): string => {
  if (!risk.openPositionCount) {
    return [
      '🛡️ <b>PORTFOLIO RISK</b>',
      'No open paper positions. Open a paper position first, then use this view to audit concentration and research freshness.',
      '<i>This tool is a conservative research-risk check, not personalized investment advice.</i>',
    ].join('\n\n');
  }
  return [
    '🛡️ <b>PORTFOLIO RISK</b>',
    `Open paper positions: ${risk.openPositionCount} across ${risk.tickerCount} tickers · notional ${formatCzk(risk.totalNotionalCzk)}`,
    `Concentration: HHI ${risk.concentrationHhi.toFixed(2)} · largest ${risk.positions[0]?.ticker ?? 'n/a'} ${risk.positions[0]?.weightPercent.toFixed(0) ?? '0'}%`,
    '<b>Exposure</b>',
    risk.positions
      .map(
        (position) =>
          `• <b>${htmlText(position.ticker, 30)}</b> — ${position.weightPercent.toFixed(1)}% · ${formatCzk(position.amountCzk)} · ${htmlText(position.sector ?? 'unclassified', 80)}\n  Research: ${position.thesisConfidence === null ? 'n/a' : `${Math.round(position.thesisConfidence * 100)}% confidence`} · ${position.dataCoverage === null ? 'n/a' : `${Math.round(position.dataCoverage)}% coverage`} · price age ${position.marketDataAgeHours === null ? 'n/a' : `${position.marketDataAgeHours.toFixed(0)}h`}`,
      )
      .join('\n'),
    '<b>Sector concentration</b>',
    risk.sectorConcentration
      .map(
        ({ sector, weightPercent }) =>
          `• ${htmlText(sector, 80)} — ${weightPercent.toFixed(1)}%`,
      )
      .join('\n'),
    '<b>Risk flags</b>',
    risk.warnings.length
      ? risk.warnings
          .map(
            (warning) =>
              `• ${warning.level === 'HIGH' ? '🔴' : '🟠'} ${htmlText(warning.message, 280)}`,
          )
          .join('\n')
      : '• No conservative concentration, freshness, or research-quality flags were triggered.',
    '<i>Uses paper notional, stored market data, and current thesis coverage. It cannot assess your cash, debt, income, taxes, real broker holdings, liquidity, correlation, or personal risk tolerance.</i>',
  ].join('\n\n');
};
