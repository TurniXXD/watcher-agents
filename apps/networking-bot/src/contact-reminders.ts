import { createHash } from 'node:crypto';
import type { NetworkContact } from '@watcher/contact-network';
import { z } from 'zod';
import { dateInTimezone, partsInTimezone } from './time.js';

export const contactReminderJobPrefix = 'CONTACT_REACH_OUT:';

const localDateSchema = z.object({
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
});

type LocalDate = z.infer<typeof localDateSchema>;

export const contactReminderMilestoneSchema = z.enum(['2d', '7d', '1m']);
export type ContactReminderMilestone = z.infer<
  typeof contactReminderMilestoneSchema
>;

export const contactReminderPayloadSchema = z.object({
  contactId: z.string().min(1).max(80),
  metDate: z.iso.date(),
  milestone: contactReminderMilestoneSchema,
});

export type ContactReminderPayload = z.infer<
  typeof contactReminderPayloadSchema
>;

export type ContactReminderJob = {
  kind: string;
  scheduledFor: Date;
  payload: ContactReminderPayload;
};

const isRealDate = (value: LocalDate): boolean => {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day));
  return (
    date.getUTCFullYear() === value.year &&
    date.getUTCMonth() + 1 === value.month &&
    date.getUTCDate() === value.day
  );
};

export const parseContactMetDate = (
  value: string | undefined,
): LocalDate | undefined => {
  const text = value?.trim();
  if (!text) return undefined;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/u.exec(text);
  const czech = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/u.exec(text);
  const parts = iso
    ? { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }
    : czech
      ? {
          year: Number(czech[3]),
          month: Number(czech[2]),
          day: Number(czech[1]),
        }
      : undefined;
  const parsed = localDateSchema.safeParse(parts);
  return parsed.success && isRealDate(parsed.data) ? parsed.data : undefined;
};

export const canonicalContactMetDate = (
  value: string | undefined,
): string | undefined => {
  const parsed = parseContactMetDate(value);
  if (!parsed) return undefined;
  return `${String(parsed.year).padStart(4, '0')}-${String(parsed.month).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')}`;
};

const addDays = (date: LocalDate, days: number): LocalDate => {
  const shifted = new Date(
    Date.UTC(date.year, date.month - 1, date.day + days),
  );
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
};

const addMonth = (date: LocalDate): LocalDate => {
  const firstOfTargetMonth = new Date(Date.UTC(date.year, date.month, 1));
  const lastDay = new Date(
    Date.UTC(
      firstOfTargetMonth.getUTCFullYear(),
      firstOfTargetMonth.getUTCMonth() + 1,
      0,
    ),
  ).getUTCDate();
  return {
    year: firstOfTargetMonth.getUTCFullYear(),
    month: firstOfTargetMonth.getUTCMonth() + 1,
    day: Math.min(date.day, lastDay),
  };
};

const compareLocalDates = (left: LocalDate, right: LocalDate): number =>
  Date.UTC(left.year, left.month - 1, left.day) -
  Date.UTC(right.year, right.month - 1, right.day);

const reminderDate = (
  metDate: LocalDate,
  milestone: ContactReminderMilestone,
): LocalDate => {
  if (milestone === '2d') return addDays(metDate, 2);
  if (milestone === '7d') return addDays(metDate, 7);
  return addMonth(metDate);
};

const jobIdentity = (contactId: string, metDate: string): string =>
  createHash('sha256')
    .update(`contact-reminder-v1|${contactId}|${metDate}`)
    .digest('hex')
    .slice(0, 24);

const reminderMilestones = contactReminderMilestoneSchema.options;

export const buildContactReminderJobs = (input: {
  contact: NetworkContact;
  now: Date;
  timezone: string;
  graceMs?: number;
}): ContactReminderJob[] => {
  if (!input.contact.active) return [];
  const parsedMetDate = parseContactMetDate(input.contact.metDate);
  const metDate = canonicalContactMetDate(input.contact.metDate);
  if (!parsedMetDate || !metDate) return [];

  const today = partsInTimezone(input.now, input.timezone);
  if (compareLocalDates(parsedMetDate, today) > 0) return [];

  const graceMs = input.graceMs ?? 36 * 60 * 60_000;
  const identity = jobIdentity(input.contact.id, metDate);
  return reminderMilestones.flatMap((milestone) => {
    const dueDate = reminderDate(parsedMetDate, milestone);
    const scheduledFor = dateInTimezone(
      { ...dueDate, hour: 9, minute: 0 },
      input.timezone,
    );
    if (scheduledFor.getTime() < input.now.getTime() - graceMs) return [];
    return [
      {
        kind: `${contactReminderJobPrefix}${identity}:${milestone}`,
        scheduledFor,
        payload: {
          contactId: input.contact.id,
          metDate,
          milestone,
        },
      },
    ];
  });
};

export const contactReminderLead = (
  milestone: ContactReminderMilestone,
): string => {
  if (milestone === '2d') return 'Před 2 dny';
  if (milestone === '7d') return 'Před týdnem';
  return 'Před měsícem';
};
