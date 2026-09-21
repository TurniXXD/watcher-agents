import type { DatabaseClient } from './client.js';
import { PaperPositionStatus } from './generated/prisma/enums.js';

export type PaperPositionView = {
  id: string;
  ticker: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: Date;
  closedAt: Date | null;
  horizonDays: number;
  amountCzk: number;
  entryPrice: number;
  entryPriceObservedAt: Date;
  exitPrice: number | null;
  exitPriceObservedAt: Date | null;
  latestPrice: number | null;
  latestPriceObservedAt: Date | null;
  returnPercent: number | null;
  notionalProfitCzk: number | null;
  horizonElapsed: boolean;
  thesis: {
    verdict: string | null;
    confidence: number | null;
    attentionScore: number | null;
  };
};

export type PaperPositionOpenResult =
  | { status: 'NOT_WATCHED' }
  | { status: 'NO_STORED_PRICE' }
  | { status: 'OPENED'; position: PaperPositionView };

export type PaperPositionCloseResult =
  | { status: 'NOT_FOUND' }
  | { status: 'NO_STORED_PRICE' }
  | { status: 'CLOSED'; position: PaperPositionView };

const priceChange = (entry: number, exit: number | null): number | null =>
  exit === null || entry === 0 ? null : (exit / entry - 1) * 100;

const viewPosition = (
  position: {
    id: string;
    ticker: string;
    status: PaperPositionStatus;
    openedAt: Date;
    closedAt: Date | null;
    horizonDays: number;
    amountCzk: { toNumber(): number };
    entryPrice: { toNumber(): number };
    entryPriceObservedAt: Date;
    exitPrice: { toNumber(): number } | null;
    exitPriceObservedAt: Date | null;
    thesisSnapshot: unknown;
  },
  latest: { close: { toNumber(): number }; observedAt: Date } | null,
  now: Date,
): PaperPositionView => {
  const entryPrice = position.entryPrice.toNumber();
  const exitPrice = position.exitPrice?.toNumber() ?? null;
  const markPrice = exitPrice ?? latest?.close.toNumber() ?? null;
  const returnPercent = priceChange(entryPrice, markPrice);
  const snapshot =
    position.thesisSnapshot && typeof position.thesisSnapshot === 'object'
      ? position.thesisSnapshot
      : {};
  const details = snapshot as Record<string, unknown>;
  const numberOrNull = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;
  const stringOrNull = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value : null;
  const amountCzk = position.amountCzk.toNumber();
  return {
    id: position.id,
    ticker: position.ticker,
    status: position.status,
    openedAt: position.openedAt,
    closedAt: position.closedAt,
    horizonDays: position.horizonDays,
    amountCzk,
    entryPrice,
    entryPriceObservedAt: position.entryPriceObservedAt,
    exitPrice,
    exitPriceObservedAt: position.exitPriceObservedAt,
    latestPrice: exitPrice === null ? (latest?.close.toNumber() ?? null) : null,
    latestPriceObservedAt:
      exitPrice === null ? (latest?.observedAt ?? null) : null,
    returnPercent,
    notionalProfitCzk:
      returnPercent === null ? null : (amountCzk * returnPercent) / 100,
    horizonElapsed:
      now.getTime() >=
      position.openedAt.getTime() + position.horizonDays * 24 * 60 * 60_000,
    thesis: {
      verdict: stringOrNull(details.verdict),
      confidence: numberOrNull(details.confidence),
      attentionScore: numberOrNull(details.attentionScore),
    },
  };
};

export class PaperPortfolioStore {
  public constructor(private readonly db: DatabaseClient) {}

  public async openPosition(
    chatConfigId: string,
    ticker: string,
    amountCzk: number,
    horizonDays: number,
    now = new Date(),
  ): Promise<PaperPositionOpenResult> {
    const symbol = ticker.trim().toUpperCase();
    const [stock, price, thesis] = await Promise.all([
      this.db.stock.findFirst({
        where: { chatConfigId, symbol, enabled: true },
        select: { symbol: true },
      }),
      this.db.marketSnapshot.findFirst({
        where: { ticker: symbol },
        orderBy: { observedAt: 'desc' },
        select: { close: true, observedAt: true },
      }),
      this.db.companyThesisState.findUnique({
        where: { ticker: symbol },
        select: { verdict: true, confidence: true, attentionScore: true },
      }),
    ]);
    if (!stock) return { status: 'NOT_WATCHED' };
    if (!price) return { status: 'NO_STORED_PRICE' };
    const position = await this.db.paperPosition.create({
      data: {
        chatConfigId,
        ticker: symbol,
        openedAt: now,
        horizonDays,
        amountCzk,
        entryPrice: price.close,
        entryPriceObservedAt: price.observedAt,
        thesisSnapshot: thesis
          ? {
              verdict: thesis.verdict,
              confidence: thesis.confidence,
              attentionScore: thesis.attentionScore,
            }
          : {},
      },
    });
    return { status: 'OPENED', position: viewPosition(position, price, now) };
  }

  public async listPositions(
    chatConfigId: string,
    now = new Date(),
  ): Promise<PaperPositionView[]> {
    const positions = await this.db.paperPosition.findMany({
      where: { chatConfigId },
      orderBy: [{ status: 'asc' }, { openedAt: 'desc' }, { id: 'asc' }],
    });
    const tickers = [...new Set(positions.map(({ ticker }) => ticker))];
    const snapshots = await this.db.marketSnapshot.findMany({
      where: {
        ticker: { in: tickers },
      },
      orderBy: { observedAt: 'desc' },
      select: { ticker: true, close: true, observedAt: true },
    });
    const latestByTicker = new Map<string, (typeof snapshots)[number]>();
    for (const snapshot of snapshots) {
      if (!latestByTicker.has(snapshot.ticker)) {
        latestByTicker.set(snapshot.ticker, snapshot);
      }
    }
    return positions.map((position) =>
      viewPosition(position, latestByTicker.get(position.ticker) ?? null, now),
    );
  }

  public async closePosition(
    chatConfigId: string,
    ordinal: number,
    now = new Date(),
  ): Promise<PaperPositionCloseResult> {
    const openPositions = await this.db.paperPosition.findMany({
      where: { chatConfigId, status: PaperPositionStatus.OPEN },
      orderBy: [{ openedAt: 'desc' }, { id: 'asc' }],
    });
    const position = openPositions[ordinal - 1];
    if (!position) return { status: 'NOT_FOUND' };
    const price = await this.db.marketSnapshot.findFirst({
      where: {
        ticker: position.ticker,
      },
      orderBy: { observedAt: 'desc' },
      select: { close: true, observedAt: true },
    });
    if (!price) return { status: 'NO_STORED_PRICE' };
    const closed = await this.db.paperPosition.update({
      where: { id: position.id },
      data: {
        status: PaperPositionStatus.CLOSED,
        closedAt: now,
        exitPrice: price.close,
        exitPriceObservedAt: price.observedAt,
      },
    });
    return { status: 'CLOSED', position: viewPosition(closed, price, now) };
  }
}
