import { describe, expect, it } from 'vitest';
import { buildWeeklyPlan, type PlannerIdea } from '../planner.js';
import { isoWeekRange } from '../time.js';

const idea = (index: number): PlannerIdea => ({
  id: `idea-${index}`,
  title: `Praktická automatizace procesu ${index}`,
  description: `Ověřená poznámka z projektu ${index}`,
  createdAt: new Date(
    `2026-09-${String(index + 1).padStart(2, '0')}T08:00:00Z`,
  ),
  updatedAt: new Date('2026-09-20T08:00:00Z'),
  status: 'BACKLOG',
  priority: index < 2 ? 'HIGH' : 'MEDIUM',
  businessObjective: 'QUALIFIED_LEADS',
  topics: [{ topic: { id: 'ai', name: 'AI automatizace' } }],
  projects: [{ project: { id: `project-${index}`, name: `Projekt ${index}` } }],
  contentItems: [],
});

const answers = {
  workedOn: 'CRM automatizace',
  discovered: 'lokální LLM',
  problem: 'ruční přepisování dat',
  promotedService: 'automatizace firemních procesů',
  assets: 'screenshot aplikace',
  preparationMinutes: 700,
};

describe('deterministic social planner', () => {
  it('plans weekly channels and due monthly formats within the budget', () => {
    const plan = buildWeeklyPlan({
      ideas: Array.from({ length: 8 }, (_, index) => idea(index)),
      existingContent: [],
      answers,
      week: isoWeekRange(new Date('2026-10-12T08:00:00Z'), 'Europe/Prague'),
      timezone: 'Europe/Prague',
    });
    expect(plan.map(({ channel }) => channel)).toEqual([
      'LINKEDIN',
      'INSTAGRAM',
      'LINKEDIN',
      'INSTAGRAM',
      'BLOG',
      'NEWSLETTER',
    ]);
    expect(
      plan.reduce((sum, item) => sum + item.estimatedPreparationMinutes, 0),
    ).toBeLessThanOrEqual(answers.preparationMinutes);
  });

  it('creates no filler when the available time is too short', () => {
    const plan = buildWeeklyPlan({
      ideas: [idea(1)],
      existingContent: [],
      answers: { ...answers, preparationMinutes: 30 },
      week: isoWeekRange(new Date('2026-10-12T08:00:00Z'), 'Europe/Prague'),
      timezone: 'Europe/Prague',
    });
    expect(plan).toEqual([]);
  });

  it('does not reuse a recently published idea on the same channel', () => {
    const plan = buildWeeklyPlan({
      ideas: [idea(1), idea(2)],
      existingContent: [
        {
          ideaId: 'idea-1',
          channel: 'LINKEDIN',
          status: 'PUBLISHED',
          plannedAt: null,
          publishedAt: new Date('2026-10-01T08:00:00Z'),
        },
      ],
      answers: { ...answers, preparationMinutes: 45 },
      week: isoWeekRange(new Date('2026-10-12T08:00:00Z'), 'Europe/Prague'),
      timezone: 'Europe/Prague',
    });
    expect(plan[0]?.ideaId).toBe('idea-2');
  });
});
