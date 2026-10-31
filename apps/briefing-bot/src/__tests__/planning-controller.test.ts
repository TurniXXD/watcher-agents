import { describe, expect, it, vi } from 'vitest';
import { PlanningController } from '../planning/controller.js';

describe('PlanningController morning prompt', () => {
  it('omits long-term goals and explains both ways to add a task', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const store = {
      ensureSession: vi.fn().mockResolvedValue({
        id: 'morning-session',
        status: 'PENDING',
        draft: {},
      }),
      listTasks: vi.fn().mockResolvedValue([]),
      latestCompletedReviews: vi.fn().mockResolvedValue({}),
      updateSession: vi.fn().mockResolvedValue(undefined),
    };
    const goals = {
      list: vi.fn().mockResolvedValue([
        {
          id: 1,
          title: 'Long-term goal that must stay out of the prompt',
          dueOn: '2030-01-01',
          horizon: 'LONG_TERM',
        },
        {
          id: 2,
          title: 'Monthly focus',
          dueOn: '2026-10-31',
          horizon: 'MONTHLY',
        },
      ]),
    };
    const controller = new PlanningController({
      store: store as never,
      goals,
      timezone: 'Europe/Prague',
      laptopReminderEnabled: false,
      mirrorReminderEnabled: false,
      startJournal: vi.fn(),
      now: () => new Date('2026-10-31T08:00:00.000Z'),
    });

    await controller.commandMorning({
      chat: { id: 12 },
      from: { id: 34 },
      reply,
    } as never);

    const message = String(reply.mock.calls[0]?.[0]);
    expect(message).not.toContain(
      'Long-term goal that must stay out of the prompt',
    );
    expect(message).toContain('Aktivní měsíční a týdenní cíle:');
    expect(message).toContain('Monthly focus [monthly]');
    expect(message).toContain('/task_add NÁZEV [15m|1h|1h15m]');
    expect(message).toContain(
      'můžeš dnešní úkoly zadat také přirozeným textem',
    );
  });
});
