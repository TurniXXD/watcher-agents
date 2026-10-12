import type { BriefingGoalRecord } from '@watcher/database';
import { dateParts } from './briefing-context.js';

const dayMs = 24 * 60 * 60_000;
const averageDaysPerYear = 365.2425;

export const daysUntilGoal = (dueOn: string, today: string): number =>
  Math.round(
    (Date.parse(`${dueOn}T00:00:00.000Z`) -
      Date.parse(`${today}T00:00:00.000Z`)) /
      dayMs,
  );

const isoDateParts = (date: string): [number, number, number] => {
  const [year, month, day] = date.split('-').map(Number);
  return [year!, month!, day!];
};

export const ageAtGoal = (birthDate: string, dueOn: string): number => {
  const [birthYear, birthMonth, birthDay] = isoDateParts(birthDate);
  const [goalYear, goalMonth, goalDay] = isoDateParts(dueOn);
  const birthdayReached =
    goalMonth > birthMonth || (goalMonth === birthMonth && goalDay >= birthDay);
  return goalYear - birthYear - (birthdayReached ? 0 : 1);
};

const yearsLabel = (days: number): string => {
  if (days === 0) return '0 years remaining';
  const years = Math.abs(days) / averageDaysPerYear;
  const precision = years < 1 ? 2 : 1;
  const rounded = Number(years.toFixed(precision));
  const amount = rounded === 0 ? '<0.01' : String(rounded);
  return days > 0
    ? `${amount} ${rounded === 1 ? 'year' : 'years'} remaining`
    : `${amount} ${rounded === 1 ? 'year' : 'years'} overdue`;
};

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

type GoalsMessageOptions = {
  includeIds: boolean;
  bulletList: boolean;
  birthDate?: string;
};

const renderGoals = (
  goals: readonly BriefingGoalRecord[],
  timezone: string,
  now: Date,
  limit: number,
  options: GoalsMessageOptions,
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
    const prefix = options.bulletList ? '• ' : '';
    const id = options.includeIds ? `#${goal.id} ` : '';
    const days = daysUntilGoal(goal.dueOn, today);
    const age = options.birthDate
      ? ` · age at deadline: ${ageAtGoal(options.birthDate, goal.dueOn)}`
      : '';
    lines.push(
      `${prefix}${id}${goal.title} — ${day}.${month}.${year} (${countdownLabel(days)} · ${yearsLabel(days)}${age})`,
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

export const renderGoalsMessage = (
  goals: readonly BriefingGoalRecord[],
  timezone: string,
  now: Date,
  limit = 10,
  birthDate?: string,
): string =>
  renderGoals(goals, timezone, now, limit, {
    includeIds: true,
    bulletList: false,
    ...(birthDate ? { birthDate } : {}),
  });

export const renderPeriodicGoalsMessage = (
  goals: readonly BriefingGoalRecord[],
  timezone: string,
  now: Date,
  limit = 10,
  birthDate?: string,
): string =>
  renderGoals(goals, timezone, now, limit, {
    includeIds: false,
    bulletList: true,
    ...(birthDate ? { birthDate } : {}),
  });
