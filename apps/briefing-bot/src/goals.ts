import type { BriefingGoalRecord } from '@watcher/database';
import { dateParts } from './briefing-context.js';

const dayMs = 24 * 60 * 60_000;

export const daysUntilGoal = (dueOn: string, today: string): number =>
  Math.round(
    (Date.parse(`${dueOn}T00:00:00.000Z`) -
      Date.parse(`${today}T00:00:00.000Z`)) /
      dayMs,
  );

const goalOrder = (
  goals: readonly BriefingGoalRecord[],
  today: string,
): BriefingGoalRecord[] =>
  [...goals].sort((left, right) => {
    const leftOverdue = left.dueOn < today;
    const rightOverdue = right.dueOn < today;
    if (leftOverdue !== rightOverdue) return leftOverdue ? 1 : -1;
    const dateOrder = leftOverdue
      ? right.dueOn.localeCompare(left.dueOn)
      : left.dueOn.localeCompare(right.dueOn);
    return dateOrder || left.id - right.id;
  });

const countdownLabel = (days: number): string => {
  if (days === 0) return 'today';
  if (days === 1) return 'in 1 day';
  if (days > 1) return `in ${days} days`;
  if (days === -1) return '1 day overdue';
  return `${Math.abs(days)} days overdue`;
};

export const renderGoalsMessage = (
  goals: readonly BriefingGoalRecord[],
  timezone: string,
  now: Date,
  limit = 10,
): string => {
  if (goals.length === 0) {
    return '🎯 Your goals\n\nNo goals yet. Add one with /goal_add YYYY-MM-DD Goal title.';
  }
  const today = dateParts(now, timezone).date;
  const ordered = goalOrder(goals, today);
  const shown = ordered.slice(0, limit);
  const lines = ['🎯 Your goals', ''];
  for (const goal of shown) {
    const [year, month, day] = goal.dueOn.split('-');
    lines.push(
      `#${goal.id} ${goal.title} — ${day}.${month}.${year} (${countdownLabel(daysUntilGoal(goal.dueOn, today))})`,
    );
  }
  if (shown.length < ordered.length) {
    lines.push(
      '',
      `+${ordered.length - shown.length} more · /goals to see all`,
    );
  }
  return lines.join('\n');
};
