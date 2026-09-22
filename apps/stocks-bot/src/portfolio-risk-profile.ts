import { htmlText } from '@watcher/telegram';
import { z } from 'zod';
import type { PortfolioRiskProfileView } from '@watcher/database';

const percentSchema = z.number().int().min(1).max(100);
const totalSchema = z.number().int().min(1).max(1_000_000_000);

const presets = {
  conservative: {
    tolerance: 'CONSERVATIVE',
    maxSinglePositionPercent: 10,
    maxSectorPercent: 25,
    maxTotalPaperNotionalCzk: null,
  },
  balanced: {
    tolerance: 'BALANCED',
    maxSinglePositionPercent: 20,
    maxSectorPercent: 40,
    maxTotalPaperNotionalCzk: null,
  },
  aggressive: {
    tolerance: 'AGGRESSIVE',
    maxSinglePositionPercent: 30,
    maxSectorPercent: 60,
    maxTotalPaperNotionalCzk: null,
  },
} as const satisfies Record<string, PortfolioRiskProfileView>;

export type PortfolioRiskProfileRequest =
  { status: 'VIEW' } | { status: 'SET'; profile: PortfolioRiskProfileView };

export const portfolioRiskProfileUsage =
  'Usage: /risk_profile\n/risk_profile conservative|balanced|aggressive [--max-position PERCENT] [--max-sector PERCENT] [--max-total-czk AMOUNT|none]\nExample: /risk_profile balanced --max-position 15 --max-sector 35 --max-total-czk 100000';

export const parsePortfolioRiskProfileRequest = (
  rawInput: string,
): PortfolioRiskProfileRequest => {
  const parts = rawInput.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  if (parts.length === 0) return { status: 'VIEW' };
  const preset = presets[parts.shift() as keyof typeof presets];
  if (!preset) throw new Error(portfolioRiskProfileUsage);
  const profile: PortfolioRiskProfileView = { ...preset };
  const seen = new Set<string>();
  for (let index = 0; index < parts.length; index += 1) {
    const flag = parts[index];
    const value = parts[index + 1];
    if (
      (flag !== '--max-position' &&
        flag !== '--max-sector' &&
        flag !== '--max-total-czk') ||
      !value ||
      value.startsWith('--') ||
      seen.has(flag)
    ) {
      throw new Error(portfolioRiskProfileUsage);
    }
    seen.add(flag);
    if (flag === '--max-total-czk' && value === 'none') {
      profile.maxTotalPaperNotionalCzk = null;
    } else {
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed)) {
        throw new Error(portfolioRiskProfileUsage);
      }
      if (flag === '--max-position') {
        profile.maxSinglePositionPercent = percentSchema.parse(parsed);
      } else if (flag === '--max-sector') {
        profile.maxSectorPercent = percentSchema.parse(parsed);
      } else {
        profile.maxTotalPaperNotionalCzk = totalSchema.parse(parsed);
      }
    }
    index += 1;
  }
  if (profile.maxSectorPercent < profile.maxSinglePositionPercent) {
    throw new Error(
      'Maximum sector exposure cannot be lower than maximum single-position exposure.\n' +
        portfolioRiskProfileUsage,
    );
  }
  return { status: 'SET', profile };
};

const formatCzk = (amount: number): string =>
  `${new Intl.NumberFormat('cs-CZ').format(amount)} Kč`;

export const renderPortfolioRiskProfile = (
  profile: PortfolioRiskProfileView,
): string =>
  [
    '🧭 <b>RISK PROFILE</b>',
    `Tolerance: <b>${htmlText(profile.tolerance.toLowerCase(), 20)}</b>`,
    `Maximum single ticker: <b>${profile.maxSinglePositionPercent}%</b> of open paper notional`,
    `Maximum sector: <b>${profile.maxSectorPercent}%</b> of open paper notional`,
    `Maximum paper notional: <b>${profile.maxTotalPaperNotionalCzk === null ? 'not set' : formatCzk(profile.maxTotalPaperNotionalCzk)}</b>`,
    '',
    'This profile only tunes warnings in /portfolio_risk. It does not evaluate suitability, block a trade, or send an order.',
  ].join('\n');
