import { z } from 'zod';

const durationSchema = z
  .string()
  .trim()
  .regex(
    /^(?:(\d{1,3})h)?(?:(\d{1,3})m)?$/iu,
    'Použij formát 15m, 1h nebo 1h15m.',
  );

export const parseDurationMinutes = (value: string): number => {
  const normalized = durationSchema.parse(value).toLowerCase();
  const match = /^(?:(\d{1,3})h)?(?:(\d{1,3})m)?$/u.exec(normalized);
  const hours = Number(match?.[1] ?? 0);
  const minutes = Number(match?.[2] ?? 0);
  const total = hours * 60 + minutes;
  if (total < 1 || minutes >= 60 || total > 24 * 60) {
    throw new z.ZodError([
      {
        code: 'custom',
        path: [],
        message:
          'Délka musí být mezi 1 minutou a 24 hodinami; minuty musí být menší než 60.',
      },
    ]);
  }
  return total;
};

export const formatDurationMinutes = (minutes: number): string => {
  const value = z
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .parse(minutes);
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  return `${hours ? `${hours}h` : ''}${remainder ? `${remainder}m` : ''}`;
};

export const taskCaptureSchema = z.object({
  title: z.string().trim().min(1).max(240),
  estimatedMinutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .optional(),
});

export type TaskCapture = z.infer<typeof taskCaptureSchema>;

const normalizedDurationToken = (value: string): string =>
  value.replace(/min$/iu, 'm');

const taskDurationSuffix = (
  value: string,
): { index: number; estimatedMinutes: number } | undefined => {
  const match =
    /(?:\s+|\s+(?:for|na)\s+)(?:\[(\d{1,3}h(?:\d{1,2}(?:m|min))?|\d{1,3}(?:m|min))\]|(\d{1,3}h(?:\d{1,2}m)?|\d{1,3}m))$/iu.exec(
      value,
    );
  const token = match?.[1] ?? match?.[2];
  return match && token
    ? {
        index: match.index,
        estimatedMinutes: parseDurationMinutes(normalizedDurationToken(token)),
      }
    : undefined;
};

export const taskEstimateFromTitle = (title: string): number | undefined => {
  const match =
    /\[(\d{1,3}h(?:\d{1,2}(?:m|min))?|\d{1,3}(?:m|min))\]\s*$/iu.exec(title);
  if (!match?.[1]) return undefined;
  const parsed = durationSchema.safeParse(normalizedDurationToken(match[1]));
  if (!parsed.success) return undefined;
  try {
    return parseDurationMinutes(parsed.data);
  } catch {
    return undefined;
  }
};

const stripTaskLead = (value: string): string =>
  value
    .trim()
    .replace(
      /^(?:today\s+i\s+want\s+to|today|i\s+want\s+to|dnes\s+chci|chci|přidej|add)\s+/iu,
      '',
    )
    .trim();

const parseTaskCapturePart = (part: string): TaskCapture => {
  const duration = taskDurationSuffix(part);
  const title = part
    .slice(0, duration?.index ?? part.length)
    .replace(/\s+(?:for|na)$/iu, '')
    .trim();
  return taskCaptureSchema.parse({
    title,
    ...(duration ? { estimatedMinutes: duration.estimatedMinutes } : {}),
  });
};

export const parseSingleTaskCapture = (input: string): TaskCapture =>
  parseTaskCapturePart(stripTaskLead(input).replace(/[.!]+$/u, ''));

export const parseTaskCaptures = (input: string): TaskCapture[] => {
  const normalized = stripTaskLead(input).replace(/[.!]+$/u, '');
  const parts = normalized
    .split(/\s*(?:,|;|\ba\s+pak\b)\s*/iu)
    .map((part, index) =>
      index === 0
        ? part.trim()
        : part
            .trim()
            .replace(/^(?:and|a)\s+/iu, '')
            .trim(),
    )
    .filter(Boolean);
  return parts.map(parseTaskCapturePart);
};

export type AnalyticsTask = {
  status:
    'TODO' | 'IN_PROGRESS' | 'COMPLETED' | 'MIGRATED' | 'CANCELLED' | 'BACKLOG';
  source: 'PLANNED' | 'UNPLANNED';
  estimatedMinutes?: number;
  actualMinutes?: number;
  goalId?: number;
};

export type ExecutionMetrics = {
  plannedTasks: number;
  completedPlannedTasks: number;
  unplannedCompletedTasks: number;
  migratedTasks: number;
  cancelledTasks: number;
  completionPercentage: number;
  estimatedWorkloadMinutes: number;
  actualTrackedMinutes: number;
  linkedCompletedTasks: number;
  missingActualDuration: number;
};

export const calculateExecutionMetrics = (
  tasks: readonly AnalyticsTask[],
): ExecutionMetrics => {
  const planned = tasks.filter(({ source }) => source === 'PLANNED');
  const completedPlanned = planned.filter(
    ({ status }) => status === 'COMPLETED',
  );
  return {
    plannedTasks: planned.length,
    completedPlannedTasks: completedPlanned.length,
    unplannedCompletedTasks: tasks.filter(
      ({ source, status }) => source === 'UNPLANNED' && status === 'COMPLETED',
    ).length,
    migratedTasks: tasks.filter(({ status }) => status === 'MIGRATED').length,
    cancelledTasks: tasks.filter(({ status }) => status === 'CANCELLED').length,
    completionPercentage: planned.length
      ? Math.round((completedPlanned.length / planned.length) * 100)
      : 0,
    estimatedWorkloadMinutes: planned.reduce(
      (sum, task) => sum + (task.estimatedMinutes ?? 0),
      0,
    ),
    actualTrackedMinutes: tasks.reduce(
      (sum, task) => sum + (task.actualMinutes ?? 0),
      0,
    ),
    linkedCompletedTasks: tasks.filter(
      ({ status, goalId }) => status === 'COMPLETED' && goalId !== undefined,
    ).length,
    missingActualDuration: tasks.filter(
      ({ status, actualMinutes }) =>
        status === 'COMPLETED' && actualMinutes === undefined,
    ).length,
  };
};

export const reviewOrderForDate = (
  date: string,
  timezone = 'Europe/Prague',
): ('DAILY' | 'JOURNAL' | 'WEEKLY' | 'MONTHLY')[] => {
  const instant = new Date(`${date}T12:00:00.000Z`);
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  }).format(instant);
  const [year, month, day] = date.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year ?? 0, month ?? 0, 0)).getUTCDate();
  return [
    'DAILY',
    'JOURNAL',
    ...(weekday === 'Sun' ? (['WEEKLY'] as const) : []),
    ...(day === lastDay ? (['MONTHLY'] as const) : []),
  ];
};
