import type { SalesStore, TelegramOutboxStore } from '@watcher/database';
import { splitTelegramMessage } from '@watcher/telegram';

export const salesFollowupKind = 'SALES_FOLLOWUP_CALLS';

type SentEmailEvent = Awaited<
  ReturnType<SalesStore['listSentEmailEvents']>
>[number];

export type FollowupSlot = {
  date: string;
  fromDate: string;
  nextCallDate: string;
  sunday: boolean;
};

const dateParts = (at: Date, timezone: string) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );

export const localDate = (at: Date, timezone: string): string => {
  const parts = dateParts(at, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const shiftDate = (date: string, days: number): string => {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
};

export const followupSlotAt = (
  now: Date,
  timezone: string,
  deliveryTime: string,
): FollowupSlot | undefined => {
  const parts = dateParts(now, timezone);
  if (parts.weekday === 'Fri' || parts.weekday === 'Sat') return undefined;
  const [targetHour, targetMinute] = deliveryTime.split(':').map(Number);
  if (
    Number(parts.hour) * 60 + Number(parts.minute) <
    targetHour! * 60 + targetMinute!
  )
    return undefined;
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const sunday = parts.weekday === 'Sun';
  return {
    date,
    fromDate: sunday ? shiftDate(date, -2) : date,
    nextCallDate: shiftDate(date, 1),
    sunday,
  };
};

const safeLine = (value: string, max = 180): string =>
  value
    .replaceAll(/\p{Cc}+/gu, ' ')
    .trim()
    .slice(0, max);

const statusNote = (stage: string): string => {
  if (['BOUNCED', 'UNSUBSCRIBED', 'NOT_INTERESTED'].includes(stage))
    return 'NEVOLAT bez ověření – negativní stav';
  if (['REPLIED', 'INTERESTED'].includes(stage))
    return 'odpověděl – před voláním zkontroluj reakci';
  return 'odeslaný e-mail';
};

export const renderFollowupReport = (
  slot: FollowupSlot,
  events: readonly SentEmailEvent[],
  timezone: string,
): string => {
  const contacts = new Map<
    string,
    { lead: NonNullable<SentEmailEvent['lead']>; count: number }
  >();
  for (const event of events) {
    if (!event.lead || !event.lead.email || !event.occurredAt) continue;
    const sentDate = localDate(event.occurredAt, timezone);
    if (sentDate < slot.fromDate || sentDate > slot.date) continue;
    const key = event.lead.email.toLowerCase();
    const previous = contacts.get(key);
    contacts.set(key, {
      lead: event.lead,
      count: (previous?.count ?? 0) + 1,
    });
  }
  const range = slot.sunday
    ? `${slot.fromDate}–${slot.date} (pá–ne)`
    : slot.date;
  const heading = `📞 Cold cally na ${slot.nextCallDate}\nPotvrzené odeslané e-maily: ${range} · ${contacts.size} kontaktů`;
  if (contacts.size === 0)
    return `${heading}\n\nNejsou evidované žádné události email.sent. Pokud Quickly e-maily odeslalo, zkontroluj webhook.`;
  const rows = [...contacts.values()].map(({ lead, count }, index) =>
    [
      `${index + 1}. ${safeLine(lead.companyName)} · ${safeLine(lead.email ?? '')}`,
      `Telefon: ${lead.phone ? safeLine(lead.phone, 40) : 'není evidován – zkontroluj web'}`,
      `Web: ${safeLine(lead.phoneSourceUrl ?? lead.contactSourceUrl ?? lead.websiteUrl ?? 'není evidován', 250)}`,
      `Kampaň: ${safeLine(lead.campaign.name, 100)}${count > 1 ? ` · ${count} odeslané e-maily` : ''}`,
      `Stav: ${statusNote(lead.stage)}`,
      `Detail: /sales_lead ${lead.id}`,
    ].join('\n'),
  );
  return `${heading}\nPřed voláním ověř reakce, námitky a právní podmínky.\n\n${rows.join('\n\n')}`;
};

export const enqueueFollowupReports = async (
  now: Date,
  timezone: string,
  deliveryTime: string,
  userIds: ReadonlySet<number>,
  store: Pick<SalesStore, 'listSentEmailEvents'>,
  outbox: Pick<TelegramOutboxStore, 'hasMessage' | 'enqueueMany'>,
): Promise<number> => {
  const slot = followupSlotAt(now, timezone, deliveryTime);
  if (!slot || userIds.size === 0) return 0;
  const pendingUsers: number[] = [];
  for (const userId of userIds) {
    if (
      !(await outbox.hasMessage(salesFollowupKind, `${userId}:${slot.date}:0`))
    )
      pendingUsers.push(userId);
  }
  if (pendingUsers.length === 0) return 0;

  // A one-day UTC margin on each side covers every supported local UTC offset.
  const from = new Date(
    Date.parse(`${slot.fromDate}T00:00:00.000Z`) - 86_400_000,
  );
  const to = new Date(
    Date.parse(`${shiftDate(slot.date, 1)}T00:00:00.000Z`) + 86_400_000,
  );
  const events = await store.listSentEmailEvents(from, to);
  const parts = splitTelegramMessage(
    renderFollowupReport(slot, events, timezone),
  );
  await outbox.enqueueMany(
    pendingUsers.flatMap((userId) =>
      parts.map((body, index) => ({
        kind: salesFollowupKind,
        deduplicationKey: `${userId}:${slot.date}:${index}`,
        chatId: BigInt(userId),
        body,
      })),
    ),
  );
  return pendingUsers.length;
};
