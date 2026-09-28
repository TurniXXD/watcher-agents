import { describe, expect, it } from 'vitest';
import { daysUntilGoal, renderGoalsMessage } from '../goals.js';

describe('briefing goals', () => {
  it('counts calendar days in the configured timezone across DST', () => {
    expect(daysUntilGoal('2026-03-30', '2026-03-28')).toBe(2);
    expect(daysUntilGoal('2026-03-27', '2026-03-28')).toBe(-1);
    expect(
      renderGoalsMessage(
        [{ id: 1, title: 'Finish project', dueOn: '2026-03-30' }],
        'Europe/Prague',
        new Date('2026-03-28T23:30:00.000Z'),
      ),
    ).toContain('30.03.2026 (in 1 day)');
  });

  it('shows the 10 nearest active deadlines, then recent overdue goals', () => {
    const goals = [
      { id: 1, title: 'Old goal', dueOn: '2026-01-01' },
      ...Array.from({ length: 11 }, (_, index) => ({
        id: index + 2,
        title: `Goal ${index + 1}`,
        dueOn: `2026-10-${String(index + 1).padStart(2, '0')}`,
      })),
    ];
    const rendered = renderGoalsMessage(
      goals,
      'Europe/Prague',
      new Date('2026-09-28T08:00:00.000Z'),
    );

    expect(rendered).toContain('#2 Goal 1');
    expect(rendered).toContain('#11 Goal 10');
    expect(rendered).not.toContain('#12 Goal 11');
    expect(rendered).not.toContain('Old goal');
    expect(rendered).toContain('+2 more · /goals to see all');
  });

  it('offers the add command when the list is empty', () => {
    expect(renderGoalsMessage([], 'Europe/Prague', new Date())).toContain(
      '/goal_add YYYY-MM-DD Goal title',
    );
  });
});
