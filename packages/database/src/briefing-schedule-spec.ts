import { computeNextRun } from '@watcher/core';

export const defaultBriefingScheduleSpec =
  '07:00;20:00;weekly:MON:07:00;weekly:SUN:20:00';

export type BriefingScheduleEntry = {
  key: string;
  label: string;
  cron: string;
  periodHours?: number;
};

export type BriefingScheduleOccurrence = {
  entry: BriefingScheduleEntry;
  scheduledFor: Date;
};

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const weeklyPattern =
  /^weekly:(MON|TUE|WED|THU|FRI|SAT|SUN):(([01]\d|2[0-3]):[0-5]\d)$/i;

const weekdayNumbers: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

const parseTime = (time: string): { hour: number; minute: number } => {
  const [hour, minute] = time.split(':').map(Number);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour === undefined ||
    hour < 0 ||
    hour > 23 ||
    minute === undefined ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error(`Invalid briefing time: ${time}`);
  }
  return { hour, minute };
};

const entryForPart = (part: string): BriefingScheduleEntry => {
  if (timePattern.test(part)) {
    const { hour, minute } = parseTime(part);
    return {
      key: `daily:${part}`,
      label: `daily ${part}`,
      cron: `${minute} ${hour} * * *`,
    };
  }

  const weekly = weeklyPattern.exec(part);
  if (!weekly) {
    throw new Error(
      `Invalid briefing schedule part: ${part}. Expected HH:mm or weekly:DAY:HH:mm.`,
    );
  }

  const day = weekly[1]!.toUpperCase();
  const time = weekly[2]!;
  const { hour, minute } = parseTime(time);
  return {
    key: `weekly:${day}:${time}`,
    label: `weekly ${day} ${time}`,
    cron: `${minute} ${hour} * * ${weekdayNumbers[day]}`,
    periodHours: 24 * 7,
  };
};

export const parseBriefingScheduleSpec = (
  scheduleSpec: string,
): BriefingScheduleEntry[] => {
  const entries = scheduleSpec
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map(entryForPart);
  if (entries.length === 0) {
    throw new Error('Briefing schedule must include at least one time.');
  }

  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.key)) return false;
    seen.add(entry.key);
    return true;
  });
};

export const normalizeBriefingScheduleSpec = (scheduleSpec: string): string =>
  parseBriefingScheduleSpec(scheduleSpec)
    .map((entry) => entry.key.replace(/^daily:/, ''))
    .join(';');

const compareOccurrences = (
  left: BriefingScheduleOccurrence,
  right: BriefingScheduleOccurrence,
): number =>
  left.scheduledFor.getTime() - right.scheduledFor.getTime() ||
  (right.entry.periodHours ?? 24) - (left.entry.periodHours ?? 24);

export const nextBriefingOccurrence = (
  scheduleSpec: string,
  timezone: string,
  after: Date,
): BriefingScheduleOccurrence => {
  const occurrences = parseBriefingScheduleSpec(scheduleSpec)
    .map((entry) => ({
      entry,
      scheduledFor: computeNextRun(entry.cron, timezone, after),
    }))
    .sort(compareOccurrences);
  const next = occurrences[0];
  if (!next) {
    throw new Error(
      `Briefing schedule has no future occurrence: ${scheduleSpec}`,
    );
  }
  return next;
};

export const briefingOccurrenceAt = (
  scheduleSpec: string,
  timezone: string,
  scheduledFor: Date,
): BriefingScheduleOccurrence => {
  const beforeScheduledMinute = new Date(scheduledFor.getTime() - 60_000);
  const occurrences = parseBriefingScheduleSpec(scheduleSpec)
    .map((entry) => ({
      entry,
      scheduledFor: computeNextRun(entry.cron, timezone, beforeScheduledMinute),
    }))
    .filter(
      (occurrence) =>
        occurrence.scheduledFor.getTime() === scheduledFor.getTime(),
    )
    .sort(compareOccurrences);
  return (
    occurrences[0] ??
    nextBriefingOccurrence(scheduleSpec, timezone, beforeScheduledMinute)
  );
};
