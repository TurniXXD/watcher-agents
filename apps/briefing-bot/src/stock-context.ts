import type { WatcherLogger } from '@watcher/core';
import type { EarningsReminderCandidate } from '@watcher/database';
import { dateParts } from './briefing-context.js';
import { calendarDayWindow } from './calendar.js';

export type UpcomingWatchlistEarning = {
  ticker: string;
  companyName: string | null;
  date: string;
  dateLabel: string;
  daysUntil: number;
  sourceUrl?: string;
};

export type WatchlistEarningsContext = {
  status: 'AVAILABLE' | 'UNAVAILABLE' | 'DISABLED';
  events: UpcomingWatchlistEarning[];
};

export type WatchlistEarningsSource = {
  list(
    telegramChatId: bigint,
    window: { from: Date; through: Date },
  ): Promise<readonly EarningsReminderCandidate[]>;
};

const DAY_MS = 24 * 60 * 60_000;

const daySerial = (date: string): number =>
  Date.parse(`${date}T00:00:00.000Z`) / DAY_MS;

export const upcomingWatchlistEarnings = (
  candidates: readonly EarningsReminderCandidate[],
  now: Date,
  timezone: string,
): UpcomingWatchlistEarning[] => {
  const today = daySerial(dateParts(now, timezone).date);
  const byTickerAndDay = new Map<string, UpcomingWatchlistEarning>();
  for (const candidate of candidates) {
    if (!candidate.exactDateKnown) continue;
    const date = dateParts(candidate.expectedStart, timezone).date;
    const daysUntil = daySerial(date) - today;
    if (daysUntil < 0 || daysUntil > 14) continue;
    const ticker = candidate.ticker.toUpperCase();
    const key = `${ticker}:${date}`;
    if (byTickerAndDay.has(key)) continue;
    byTickerAndDay.set(key, {
      ticker,
      companyName: candidate.companyName,
      date,
      dateLabel: new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        month: 'short',
        day: 'numeric',
      }).format(candidate.expectedStart),
      daysUntil,
      ...(candidate.sourceUrl ? { sourceUrl: candidate.sourceUrl } : {}),
    });
  }
  return [...byTickerAndDay.values()].sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.ticker.localeCompare(right.ticker),
  );
};

export const loadWatchlistEarnings = async (
  source: WatchlistEarningsSource,
  telegramChatId: bigint,
  now: Date,
  timezone: string,
  logger?: WatcherLogger,
): Promise<WatchlistEarningsContext> => {
  const window = {
    from: calendarDayWindow(now, timezone).start,
    through: calendarDayWindow(now, timezone, 14).end,
  };
  try {
    const candidates = await source.list(telegramChatId, window);
    return {
      status: 'AVAILABLE',
      events: upcomingWatchlistEarnings(candidates, now, timezone),
    };
  } catch (error) {
    logger?.warn({ err: error }, 'Watchlist earnings calendar unavailable');
    return { status: 'UNAVAILABLE', events: [] };
  }
};
