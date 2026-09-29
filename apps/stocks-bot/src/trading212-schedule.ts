import { splitTelegramMessage } from '@watcher/telegram';
import {
  trading212ScheduledKind,
  type TelegramOutboxStore,
  type Trading212ScheduleStore,
} from '@watcher/database';
import type { Trading212Client } from './trading212.js';
import { renderTrading212Positions } from './trading212.js';

const newYorkClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export type Trading212Slot = { date: string; name: 'before' | 'after' };

export const trading212SlotAt = (now: Date): Trading212Slot | undefined => {
  const parts = Object.fromEntries(
    newYorkClock.formatToParts(now).map((part) => [part.type, part.value]),
  );
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return undefined;
  if (parts.hour !== '09') return undefined;
  const minute = Number(parts.minute);
  const name =
    minute >= 25 && minute < 30
      ? 'before'
      : minute >= 35 && minute < 40
        ? 'after'
        : undefined;
  if (!name) return undefined;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    name,
  };
};

export const enqueueTrading212Positions = async (
  now: Date,
  chatId: bigint,
  schedule: Pick<Trading212ScheduleStore, 'enabled'>,
  client: Pick<Trading212Client, 'getPortfolio'>,
  outbox: Pick<TelegramOutboxStore, 'enqueue'>,
): Promise<boolean> => {
  const slot = trading212SlotAt(now);
  if (!slot || !(await schedule.enabled(chatId))) return false;
  const portfolio = await client.getPortfolio();
  const heading =
    slot.name === 'before'
      ? '📊 Trading 212 · před otevřením trhu'
      : '📊 Trading 212 · po otevření trhu';
  const parts = splitTelegramMessage(
    `${heading}\n${slot.date} · čas New York\n\n${renderTrading212Positions(portfolio)}`,
  );
  for (const [index, body] of parts.entries()) {
    await outbox.enqueue({
      kind: trading212ScheduledKind,
      deduplicationKey: `${chatId}:${slot.date}:${slot.name}:${index}`,
      chatId,
      body,
    });
  }
  return true;
};
