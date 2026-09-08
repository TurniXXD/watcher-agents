import { parseScheduleExpressions } from '@watcher/core';

export const renderStockSchedules = (
  schedule: string,
  timezone: string,
  nextRunAt?: Date | null,
): string => {
  const expressions = parseScheduleExpressions(schedule);
  const entries = expressions
    .map((expression, index) => `${index + 1}. ${expression}`)
    .join('\n');
  const nextRun = nextRunAt ? `\nNext run: ${nextRunAt.toISOString()}` : '';
  return `Stock schedules (${timezone})\n${entries}${nextRun}\n\nAll schedules use the same timezone.`;
};

export const appendStockSchedule = (
  schedule: string,
  expression: string,
): { schedule: string; added: boolean } => {
  const additions = parseScheduleExpressions(expression);
  if (additions.length !== 1) {
    throw new Error('Add exactly one cron expression at a time.');
  }
  const expressions = parseScheduleExpressions(schedule);
  const addition = additions[0]!;
  if (expressions.includes(addition)) {
    return { schedule: expressions.join('; '), added: false };
  }
  return { schedule: [...expressions, addition].join('; '), added: true };
};

export const removeStockSchedule = (
  schedule: string,
  oneBasedIndex: number,
): string => {
  const expressions = parseScheduleExpressions(schedule);
  if (!Number.isInteger(oneBasedIndex) || oneBasedIndex < 1) {
    throw new Error('Schedule number must be a positive integer.');
  }
  if (oneBasedIndex > expressions.length) {
    throw new Error(`Schedule ${oneBasedIndex} does not exist.`);
  }
  if (expressions.length === 1) {
    throw new Error('At least one schedule is required. Use /pause instead.');
  }
  expressions.splice(oneBasedIndex - 1, 1);
  return expressions.join('; ');
};
