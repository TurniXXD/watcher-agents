import type { BriefingTaskRecord } from '@watcher/database';
import { describe, expect, it, vi } from 'vitest';
import { PlanningController } from '../planning/controller.js';

const task = (
  overrides: Partial<BriefingTaskRecord> = {},
): BriefingTaskRecord => ({
  id: '11111111-1111-4111-8111-111111111111',
  telegramChatId: 12n,
  title: 'Připravit pondělní cally',
  planningDate: '2026-10-31',
  status: 'TODO',
  priority: 'NORMAL',
  tags: [],
  source: 'PLANNED',
  syncStatus: 'PENDING',
  migrationCount: 0,
  ...overrides,
});

const controllerWith = (store: object): PlanningController =>
  new PlanningController({
    store: store as never,
    goals: { list: vi.fn().mockResolvedValue([]) },
    timezone: 'Europe/Prague',
    laptopReminderEnabled: false,
    mirrorReminderEnabled: false,
    startJournal: vi.fn(),
    now: () => new Date('2026-10-31T08:00:00.000Z'),
  });

type TaskMessageOptions = {
  parse_mode?: string;
  reply_markup: {
    inline_keyboard: { text: string; callback_data?: string }[][];
  };
};

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
    expect(message).toContain(
      '/task_add [--priority|--do-first] NÁZEV [15m|1h|1h15m]',
    );
    expect(message).toContain(
      'můžeš dnešní úkoly zadat také přirozeným textem',
    );
  });

  it('shows the known total and one inline completion button per active task', async () => {
    const reply = vi
      .fn<(text: string, options?: TaskMessageOptions) => Promise<undefined>>()
      .mockResolvedValue(undefined);
    const tasks = [
      task({ estimatedMinutes: 180, priority: 'HIGH' }),
      task({
        id: '22222222-2222-4222-8222-222222222222',
        title: 'Rozjet contact formy',
        estimatedMinutes: 60,
        priority: 'PRIMARY',
        tags: ['do-first'],
      }),
      task({
        id: '33333333-3333-4333-8333-333333333333',
        title: 'Naučit se nové pickup lines & navázat',
        status: 'COMPLETED',
      }),
    ];
    const controller = controllerWith({
      listTasks: vi.fn().mockResolvedValue(tasks),
    });

    await controller.commandTasks({ chat: { id: 12 }, reply } as never);

    const message = String(reply.mock.calls[0]?.[0]);
    expect(message).toContain('⏱ Odhad celkem: nejméně 4h');
    expect(message).toContain('1 úkol bez odhadu');
    expect(message).toContain('⭐ Připravit pondělní cally');
    expect(message).toContain('🚀 Rozjet contact formy');
    expect(message).toContain('✓ Naučit se nové pickup lines &amp; navázat');
    expect(message).toContain('<s>');
    const options = reply.mock.calls[0]?.[1];
    expect(options?.parse_mode).toBe('HTML');
    const keyboard = options?.reply_markup;
    expect(keyboard).toBeDefined();
    if (!keyboard) throw new Error('Expected the task completion keyboard');
    expect(keyboard.inline_keyboard.flat()).toEqual([
      expect.objectContaining({
        callback_data: 'plan:task:11111111-1111-4111-8111-111111111111:done',
      }),
      expect.objectContaining({
        callback_data: 'plan:task:22222222-2222-4222-8222-222222222222:done',
      }),
    ]);
  });

  it('maps task_add priority flags to ordered persisted tasks', async () => {
    const createTask = vi.fn(async (_chatId: bigint, input: object) =>
      task(input as Partial<BriefingTaskRecord>),
    );
    const controller = controllerWith({ createTask });
    const context = {
      chat: { id: 12 },
      reply: vi.fn().mockResolvedValue(undefined),
    } as never;

    await controller.commandAdd(
      context,
      '--priority Připravit pondělní cally 1h',
    );
    await controller.commandAdd(context, 'Rozjet contact formy 2h --do-first');

    expect(createTask).toHaveBeenNthCalledWith(1, 12n, {
      title: 'Připravit pondělní cally',
      estimatedMinutes: 60,
      planningDate: '2026-10-31',
      priority: 'HIGH',
      tags: [],
    });
    expect(createTask).toHaveBeenNthCalledWith(2, 12n, {
      title: 'Rozjet contact formy',
      estimatedMinutes: 120,
      planningDate: '2026-10-31',
      priority: 'PRIMARY',
      tags: ['do-first'],
    });
  });

  it('completes only an owned task from its inline callback and refreshes the list', async () => {
    const active = task();
    const completed = task({ status: 'COMPLETED' });
    const store = {
      resolveTask: vi.fn().mockResolvedValue([active]),
      updateTask: vi.fn().mockResolvedValue(completed),
      listTasks: vi.fn().mockResolvedValue([completed]),
    };
    const controller = controllerWith(store);
    const editMessageText = vi
      .fn<(text: string, options: TaskMessageOptions) => Promise<undefined>>()
      .mockResolvedValue(undefined);
    const context = {
      chat: { id: 12 },
      answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
      editMessageText,
    };

    await controller.handleTaskCallback(context as never, active.id);

    expect(store.resolveTask).toHaveBeenCalledWith(
      12n,
      active.id,
      '2026-10-31',
    );
    expect(store.updateTask).toHaveBeenCalledWith(12n, active.id, {
      status: 'COMPLETED',
    });
    expect(context.answerCallbackQuery).toHaveBeenCalledWith(
      `Hotovo: ${active.title}`,
    );
    const edited = editMessageText.mock.calls[0];
    expect(edited?.[0]).toContain(`<s>✓ ${active.title}`);
    expect(edited?.[1].parse_mode).toBe('HTML');
    expect(edited?.[1].reply_markup.inline_keyboard).toEqual([]);
  });

  it('does not mutate a task that is not owned by the callback chat', async () => {
    const store = {
      resolveTask: vi.fn().mockResolvedValue([]),
      updateTask: vi.fn(),
    };
    const controller = controllerWith(store);
    const answerCallbackQuery = vi.fn().mockResolvedValue(undefined);

    await controller.handleTaskCallback(
      { chat: { id: 99 }, answerCallbackQuery } as never,
      '11111111-1111-4111-8111-111111111111',
    );

    expect(store.resolveTask).toHaveBeenCalledWith(
      99n,
      '11111111-1111-4111-8111-111111111111',
      '2026-10-31',
    );
    expect(store.updateTask).not.toHaveBeenCalled();
    expect(answerCallbackQuery).toHaveBeenCalledWith('Úkol nebyl nalezen.');
  });
});
