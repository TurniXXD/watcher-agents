import { z } from 'zod';

const amountSchema = z.number().int().min(1).max(1_000_000_000);
const daysSchema = z.number().int().min(1).max(365);
const ordinalSchema = z.number().int().min(1).max(10_000);

export const paperOpenUsage =
  'Usage: /paper_open SYMBOL --amount-czk AMOUNT [--days DAYS]\nAMOUNT must be a whole number of CZK. DAYS is 1–365 (default: 30).\nExample: /paper_open MU --amount-czk 10000 --days 30';

export type PaperOpenRequest = {
  symbol: string;
  amountCzk: number;
  days: number;
};

export const parsePaperOpenRequest = (rawInput: string): PaperOpenRequest => {
  const parts = rawInput.trim().split(/\s+/u).filter(Boolean);
  const symbol = parts.shift();
  if (!symbol) throw new Error(paperOpenUsage);
  let amountCzk: number | undefined;
  let days = 30;
  const seenFlags = new Set<string>();
  for (let index = 0; index < parts.length; index += 1) {
    const flag = parts[index];
    const value = parts[index + 1];
    if (flag !== '--amount-czk' && flag !== '--days') {
      throw new Error(paperOpenUsage);
    }
    if (seenFlags.has(flag) || !value || value.startsWith('--')) {
      throw new Error(paperOpenUsage);
    }
    seenFlags.add(flag);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error(paperOpenUsage);
    if (flag === '--amount-czk') amountCzk = amountSchema.parse(parsed);
    else days = daysSchema.parse(parsed);
    index += 1;
  }
  if (amountCzk === undefined) throw new Error(paperOpenUsage);
  return { symbol: symbol.trim().toUpperCase(), amountCzk, days };
};

export const parsePaperCloseOrdinal = (rawInput: string): number => {
  const normalized = rawInput.trim();
  if (!/^\d+$/u.test(normalized)) {
    throw new Error(
      'Usage: /paper_close NUMBER\nUse the number shown for an open position in /paper_portfolio.',
    );
  }
  return ordinalSchema.parse(Number(normalized));
};
