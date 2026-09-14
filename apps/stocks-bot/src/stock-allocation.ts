import { decisionResultSchema, type DecisionResult } from '@watcher/core';
import { htmlText, type StockDashboardEntry } from '@watcher/telegram';
import { z } from 'zod';

const usage =
  'Usage: /allocation [--amount-czk AMOUNT] [--days DAYS]\nAMOUNT must be a whole number of CZK; DAYS must be between 1 and 365 (default: 30).\nExample: /allocation --amount-czk 100000 --days 90';

const amountSchema = z.number().int().min(1).max(1_000_000_000);
const daysSchema = z.number().int().min(1).max(365);

export type StockAllocationRequest = {
  amountCzk?: number;
  days: number;
};

export const parseStockAllocationRequest = (
  rawInput: string,
): StockAllocationRequest => {
  const parts = rawInput.trim().split(/\s+/u).filter(Boolean);
  let amountCzk: number | undefined;
  let days = 30;
  const seenFlags = new Set<string>();
  for (let index = 0; index < parts.length; index += 1) {
    const flag = parts[index];
    const value = parts[index + 1];
    if (flag !== '--amount-czk' && flag !== '--days') throw new Error(usage);
    if (seenFlags.has(flag)) throw new Error(usage);
    seenFlags.add(flag);
    if (!value || value.startsWith('--')) throw new Error(usage);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error(usage);
    if (flag === '--amount-czk') {
      amountCzk = amountSchema.parse(parsed);
    } else {
      days = daysSchema.parse(parsed);
    }
    index += 1;
  }
  return { ...(amountCzk === undefined ? {} : { amountCzk }), days };
};

type Horizon = {
  key: keyof DecisionResult['probabilityHigher'];
  label: string;
};

const horizonFor = (days: number): Horizon =>
  days <= 7
    ? { key: 'sevenDays', label: '7d' }
    : days <= 30
      ? { key: 'thirtyDays', label: '30d' }
      : days <= 90
        ? { key: 'ninetyDays', label: '90d' }
        : { key: 'twelveMonths', label: '12m' };

const midpoint = (range: { minimum: number; maximum: number }): number =>
  (range.minimum + range.maximum) / 2;

const recommendationRank: Record<DecisionResult['recommendation'], number> = {
  STRONG_BUY: 4,
  BUY: 3,
  SMALL_POSITION: 2,
  WATCH: 1,
  HOLD: 0,
  WAIT: 0,
  AVOID: -2,
  SELL: -3,
  INSUFFICIENT_DATA: -4,
};

export type StockAllocationEntry = {
  symbol: string;
  decision: DecisionResult | null;
  probability: { minimum: number; maximum: number } | null;
  confidence: number;
  coverage: number;
  score: number;
  amountCzk?: number;
};

const scoreEntry = (
  entry: StockDashboardEntry,
  horizon: Horizon,
): StockAllocationEntry => {
  const decision = decisionResultSchema.safeParse(entry.thesis?.decision);
  const parsed = decision.success ? decision.data : null;
  const probability = parsed?.probabilityHigher[horizon.key] ?? null;
  const coverage = entry.thesis?.dataCoverage ?? 0;
  const confidence = entry.thesis?.confidence ?? 0;
  const recommendation = parsed?.recommendation ?? 'INSUFFICIENT_DATA';
  const expectedValue = parsed?.expectedValuePercent ?? -100;
  const probabilityMidpoint = probability ? midpoint(probability) : 0;
  return {
    symbol: entry.stock.symbol,
    decision: parsed,
    probability,
    confidence,
    coverage,
    score:
      recommendationRank[recommendation] * 1_000 +
      expectedValue * 10 +
      probabilityMidpoint * 2 +
      coverage +
      confidence * 100,
  };
};

const allocationWeight = (entry: StockAllocationEntry): number => {
  const decision = entry.decision;
  if (
    !decision ||
    !entry.probability ||
    !['STRONG_BUY', 'BUY', 'SMALL_POSITION'].includes(
      decision.recommendation,
    ) ||
    (decision.expectedValuePercent ?? 0) <= 0 ||
    decision.maxRecommendedPositionPercent.maximum <= 0
  ) {
    return 0;
  }
  const probabilityEdge = Math.max(0, (midpoint(entry.probability) - 50) / 50);
  return Math.max(
    0,
    (decision.expectedValuePercent ?? 0) *
      probabilityEdge *
      (entry.coverage / 100) *
      entry.confidence *
      decision.maxRecommendedPositionPercent.maximum,
  );
};

export const rankStockAllocations = (
  entries: StockDashboardEntry[],
  request: StockAllocationRequest,
): StockAllocationEntry[] => {
  const horizon = horizonFor(request.days);
  const ranked = entries
    .map((entry) => scoreEntry(entry, horizon))
    .sort(
      (left, right) =>
        right.score - left.score || left.symbol.localeCompare(right.symbol),
    );
  const amountCzk = request.amountCzk;
  if (amountCzk === undefined) return ranked;
  const eligible = ranked.filter((entry) => allocationWeight(entry) > 0);
  const totalWeight = eligible.reduce(
    (total, entry) => total + allocationWeight(entry),
    0,
  );
  if (totalWeight === 0) return ranked;
  const shares = eligible.map((entry) => {
    const exactAmount = (amountCzk * allocationWeight(entry)) / totalWeight;
    return {
      entry,
      amountCzk: Math.floor(exactAmount),
      remainder: exactAmount - Math.floor(exactAmount),
    };
  });
  const distributed = shares.reduce(
    (total, share) => total + share.amountCzk,
    0,
  );
  shares
    .sort(
      (left, right) =>
        right.remainder - left.remainder ||
        right.entry.score - left.entry.score ||
        left.entry.symbol.localeCompare(right.entry.symbol),
    )
    .slice(0, amountCzk - distributed)
    .forEach((share) => {
      share.amountCzk += 1;
    });
  const allocationBySymbol = new Map(
    shares
      .filter(({ amountCzk }) => amountCzk > 0)
      .map(({ entry, amountCzk }) => [entry.symbol, amountCzk]),
  );
  return ranked.map((entry) => {
    const amountCzk = allocationBySymbol.get(entry.symbol);
    return amountCzk === undefined ? entry : { ...entry, amountCzk };
  });
};

const formatCzk = (amount: number): string =>
  `${new Intl.NumberFormat('cs-CZ').format(amount)} Kč`;

export const renderStockAllocation = (
  entries: StockAllocationEntry[],
  request: StockAllocationRequest,
): string => {
  const horizon = horizonFor(request.days);
  if (entries.length === 0) return 'No enabled stocks are configured.';
  const eligible = entries.filter(({ amountCzk }) => amountCzk !== undefined);
  const ranked = entries.map((entry, index) => {
    const decision = entry.decision;
    const probability = entry.probability
      ? `${entry.probability.minimum.toFixed(0)}–${entry.probability.maximum.toFixed(0)}%`
      : 'n/a';
    return [
      `<b>${index + 1}. ${htmlText(entry.symbol, 20)}</b>`,
      `Decision: ${htmlText(decision?.recommendation ?? 'INSUFFICIENT_DATA', 40)} · EV ${decision?.expectedValuePercent === null || decision?.expectedValuePercent === undefined ? 'n/a' : `${decision.expectedValuePercent.toFixed(1)}%`}`,
      `${horizon.label} probability higher: ${probability} · Confidence ${Math.round(entry.confidence * 100)}% · Coverage ${Math.round(entry.coverage)}%`,
      entry.amountCzk === undefined
        ? ''
        : `Research allocation: <b>${formatCzk(entry.amountCzk)}</b>`,
    ]
      .filter(Boolean)
      .join('\n');
  });
  const allocation =
    request.amountCzk === undefined
      ? 'Add <code>--amount-czk AMOUNT</code> to calculate a research allocation.'
      : eligible.length === 0
        ? `No current ticker meets the model's allocation threshold. Keep ${formatCzk(request.amountCzk)} unallocated.`
        : `Research allocation: ${formatCzk(request.amountCzk)} across ${eligible.length} eligible ticker${eligible.length === 1 ? '' : 's'}.`;
  return [
    '📐 <b>STOCK ALLOCATION RESEARCH</b>',
    `Ranking horizon: ${request.days} days · model probability bucket ${horizon.label}`,
    allocation,
    ranked.join('\n\n──────────\n\n'),
    '<i>Research output only, not financial advice. This ranks stored model evidence; verify current prices, liquidity, tax impact, diversification, and primary sources before trading.</i>',
  ].join('\n\n');
};

export { usage as stockAllocationUsage };
