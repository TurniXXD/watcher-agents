import type { SalesStore, TelegramOutboxStore } from '@watcher/database';
import { splitTelegramMessage } from '@watcher/telegram';

export const salesFollowupKind = 'SALES_FOLLOWUP_CALLS';

type CallCandidate = Awaited<
  ReturnType<SalesStore['listCallCandidates']>
>[number];

export type FollowupSlot = {
  date: string;
  nextCallDate: string;
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
  return {
    date,
    nextCallDate: shiftDate(date, 1),
  };
};

const safeLine = (value: string, max = 180): string =>
  value
    .replaceAll(/\p{Cc}+/gu, ' ')
    .trim()
    .slice(0, max);

export const renderFollowupReport = (
  slot: FollowupSlot,
  leads: readonly CallCandidate[],
): string => {
  const heading = `📞 Cold cally na ${slot.nextCallDate}\nVeřejné telefonní kontakty: ${leads.length}`;
  if (leads.length === 0)
    return `${heading}\n\nZatím nejsou žádné analyzované leady s veřejným telefonem. Importuj firmy přes /sales_find a potom spusť /sales_run.`;
  const rows = leads.map((lead, index) =>
    [
      `${index + 1}. ${safeLine(lead.companyName)} · ${lead.finalScore ?? '?'} bodů`,
      `Telefon: ${safeLine(lead.phone ?? '', 40)}`,
      ...(lead.email ? [`E-mail: ${safeLine(lead.email, 180)}`] : []),
      `Zdroj telefonu: ${safeLine(lead.phoneSourceUrl ?? '', 250)}`,
      `Web: ${safeLine(lead.websiteUrl ?? 'není evidován', 250)}`,
      `Kampaň: ${safeLine(lead.campaign.name, 100)}`,
      `Stav: ${safeLine(lead.stage, 40)}`,
      `Detail: /sales_lead ${lead.id}`,
    ].join('\n'),
  );
  return `${heading}\nPřed voláním ověř firmu, zdroj telefonu a právní podmínky.\n\n${rows.join('\n\n')}`;
};

export const enqueueFollowupReports = async (
  now: Date,
  timezone: string,
  deliveryTime: string,
  userIds: ReadonlySet<number>,
  store: Pick<SalesStore, 'listCallCandidates'>,
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

  const leads = await store.listCallCandidates(20);
  const parts = splitTelegramMessage(renderFollowupReport(slot, leads));
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
