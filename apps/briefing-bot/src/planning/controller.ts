import type {
  BriefingGoalStore,
  BriefingTaskRecord,
  BulletJournalStore,
  JournalSessionRecord,
  PlanningSessionRecord,
} from '@watcher/database';
import { InlineKeyboard, type Context } from 'grammy';
import { z } from 'zod';
import {
  calculateExecutionMetrics,
  formatDurationMinutes,
  parseDurationMinutes,
  parseTaskCaptures,
} from './domain.js';
import { todayDateInTimezone } from '../notion-journal.js';

const tomorrow = (date: string): string => {
  const instant = new Date(`${date}T12:00:00.000Z`);
  instant.setUTCDate(instant.getUTCDate() + 1);
  return instant.toISOString().slice(0, 10);
};

const previous = (date: string): string => {
  const instant = new Date(`${date}T12:00:00.000Z`);
  instant.setUTCDate(instant.getUTCDate() - 1);
  return instant.toISOString().slice(0, 10);
};

const weekRange = (date: string): { start: string; end: string } => {
  const instant = new Date(`${date}T12:00:00.000Z`);
  const day = instant.getUTCDay() || 7;
  const start = new Date(instant);
  start.setUTCDate(start.getUTCDate() - day + 1);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
};

const monthRange = (date: string): { start: string; end: string } => {
  const [year, month] = date.split('-').map(Number);
  return {
    start: `${year}-${String(month).padStart(2, '0')}-01`,
    end: new Date(Date.UTC(year ?? 0, month ?? 0, 0))
      .toISOString()
      .slice(0, 10),
  };
};

type MorningDraftTask = {
  title: string;
  estimatedMinutes?: number | undefined;
  priority?: 'NORMAL' | 'PRIMARY' | undefined;
  goalId?: number | undefined;
};

const morningDraftSchema = z.object({
  tasks: z
    .array(
      z.object({
        title: z.string(),
        estimatedMinutes: z.number().optional(),
        priority: z.enum(['NORMAL', 'PRIMARY']).optional(),
        goalId: z.number().optional(),
      }),
    )
    .default([]),
  laptopCommitmentAcknowledged: z.boolean().default(false),
  mirrorAcknowledged: z.boolean().default(false),
});

const reviewDraftSchema = z.object({
  unexpected: z.string().default(''),
  blockers: z.string().default(''),
  answers: z.record(z.string(), z.string()).default({}),
});

const shortId = (id: string): string => id.slice(0, 8);

const renderTask = (task: BriefingTaskRecord, index?: number): string => {
  const status = {
    TODO: '○',
    IN_PROGRESS: '◐',
    COMPLETED: '✓',
    MIGRATED: '→',
    CANCELLED: '×',
    BACKLOG: '□',
  }[task.status];
  return `${index === undefined ? '' : `${index + 1}. `}${status} ${task.title}${
    task.estimatedMinutes
      ? ` · odhad ${formatDurationMinutes(task.estimatedMinutes)}`
      : ''
  }${task.actualMinutes ? ` · skutečnost ${formatDurationMinutes(task.actualMinutes)}` : ''}${
    task.goalTitle ? ` · ${task.goalTitle}` : ''
  } · #${shortId(task.id)}`;
};

const morningSummary = (tasks: readonly MorningDraftTask[]): string => {
  const total = tasks.reduce(
    (sum, task) => sum + (task.estimatedMinutes ?? 0),
    0,
  );
  const lines = tasks.map(
    (task, index) =>
      `${index + 1}. ${task.priority === 'PRIMARY' ? '⭐ ' : ''}${task.title}${
        task.estimatedMinutes
          ? ` — ${formatDurationMinutes(task.estimatedMinutes)}`
          : ''
      }`,
  );
  return [
    '☀️ Dnešní plán',
    '',
    ...lines,
    '',
    `Celkový známý odhad: ${total ? formatDurationMinutes(total) : 'bez odhadů'}`,
    ...(total > 10 * 60
      ? ['⚠️ Plán přesahuje 10 hodin odhadované práce. Zvaž zúžení priorit.']
      : []),
  ].join('\n');
};

const periodQuestions = {
  WEEKLY_REVIEW: [
    'Jaké byly tvoje nejdůležitější úspěchy tento týden?',
    'Kterým cílům ses věnoval málo?',
    'Co opakovaně bránilo provedení plánů?',
    'Co ses naučil o svých prioritách nebo návycích?',
    'Co chceš příští týden změnit a jaké budou jeho hlavní cíle?',
    'Jaký jeden týdenní princip nebo cíl budeš příští týden vědomě aplikovat každý den? Např. konkrétní Carnegieho princip.',
  ],
  MONTHLY_REVIEW: [
    'Jaký smysluplný pokrok jsi tento měsíc udělal?',
    'Které cíle jsi soustavně upřednostňoval?',
    'Které cíle jsi opakovaně zanedbával?',
    'Které aktivity spotřebovaly nejvíc pozornosti?',
    'Co chceš přestat dělat?',
    'V čem chceš pokračovat?',
    'Co chceš začít dělat?',
    'Jsi spokojený se směrem, kterým jdeš, a jaké budou cíle příštího měsíce?',
    'Za kterými myšlenkami chceš příští měsíc stát? Napiš je po řádcích nebo oddělené středníkem; např. „Žijeme teď, nemusím pořád žít v budoucnosti.“',
  ],
} as const;

export type PlanningControllerOptions = {
  store: BulletJournalStore;
  goals: Pick<BriefingGoalStore, 'list'>;
  timezone: string;
  laptopReminderEnabled: boolean;
  mirrorReminderEnabled: boolean;
  startJournal: (context: Context) => Promise<void>;
  now?: () => Date;
};

export class PlanningController {
  public constructor(private readonly options: PlanningControllerOptions) {}

  public async commandMorning(context: Context): Promise<void> {
    const date = this.today();
    const session = await this.options.store.ensureSession(
      BigInt(context.chat!.id),
      BigInt(context.from!.id),
      'MORNING',
      date,
    );
    if (session.status === 'COMPLETED') {
      await this.commandTasks(context);
      return;
    }
    const unfinished = await this.options.store.listTasks(
      BigInt(context.chat!.id),
      {
        toDate: previous(date),
        statuses: ['TODO', 'IN_PROGRESS'],
      },
    );
    const goals = await this.options.goals.list(BigInt(context.chat!.id));
    const focus = await this.options.store.latestCompletedReviews(
      BigInt(context.chat!.id),
    );
    await this.options.store.updateSession(session.id, {
      status: 'IN_PROGRESS',
      currentStep: 0,
      draft: morningDraftSchema.parse(session.draft),
    });
    const goalLines = goals
      .filter((goal) => goal.horizon === 'MONTHLY' || goal.horizon === 'WEEKLY')
      .slice(0, 10)
      .map(
        (goal) =>
          `• ${goal.title}${goal.horizon ? ` [${goal.horizon.toLowerCase()}]` : ''}`,
      );
    const unfinishedLines = unfinished
      .slice(0, 15)
      .map((task) => renderTask(task));
    const reminderKeyboard = new InlineKeyboard();
    if (this.options.laptopReminderEnabled) {
      reminderKeyboard.text('✅ Závazek potvrzen', `plan:${session.id}:laptop`);
    }
    if (this.options.mirrorReminderEnabled) {
      if (this.options.laptopReminderEnabled) reminderKeyboard.row();
      reminderKeyboard.text('🪞 Reflexe hotová', `plan:${session.id}:mirror`);
    }
    await context.reply(
      [
        `☀️ Ranní plán — ${date}`,
        '',
        ...(this.options.laptopReminderEnabled
          ? [
              '⚠️ Neotvírej notebook ani nezačínej pracovat, dokud nemáš definované dnešní cíle.',
            ]
          : []),
        ...(this.options.mirrorReminderEnabled
          ? [
              '🪞 Podívej se do zrcadla a zeptej se: „Jsem spokojený se směrem, kterým se můj život ubírá?“',
              '„Vedou dnešní plány k člověku, kterým se chci stát?“',
            ]
          : []),
        ...(goalLines.length
          ? ['', 'Aktivní měsíční a týdenní cíle:', ...goalLines]
          : []),
        ...(focus.monthly?.monthlyPrinciples.length
          ? [
              '',
              'Myšlenky pro tento měsíc:',
              ...focus.monthly.monthlyPrinciples.map(
                (principle) => `• ${principle}`,
              ),
            ]
          : []),
        ...(focus.weekly?.dailyPractice
          ? [
              '',
              'Jeden princip k denní aplikaci tento týden:',
              `• ${focus.weekly.dailyPractice}`,
            ]
          : []),
        '',
        'Nedokončené úkoly:',
        ...(unfinishedLines.length
          ? unfinishedLines
          : ['• žádné nedokončené úkoly']),
        '',
        'Starší úkol můžeš přesunout pomocí /task_move ID YYYY-MM-DD, zrušit přes /task_cancel ID nebo nechat v backlogu během večerního review.',
        'Nový úkol přidáš přes /task_add NÁZEV [15m|1h|1h15m]. Po „pokračovat“ můžeš dnešní úkoly zadat také přirozeným textem.',
        'Až je seznam vyřešený, napiš „pokračovat“.',
      ].join('\n'),
      reminderKeyboard.inline_keyboard.length
        ? { reply_markup: reminderKeyboard }
        : undefined,
    );
  }

  public async commandTasks(context: Context): Promise<void> {
    const tasks = await this.options.store.listTasks(BigInt(context.chat!.id), {
      fromDate: this.today(),
      toDate: this.today(),
    });
    await context.reply(
      tasks.length
        ? [
            '📋 Dnešní úkoly',
            '',
            ...tasks.map((task, index) => renderTask(task, index)),
          ].join('\n')
        : 'Dnes zatím nemáš žádné úkoly. Přidej je přes /task_add NÁZEV [DÉLKA] nebo /plan.',
    );
  }

  public async commandPriorities(context: Context): Promise<void> {
    const tasks = await this.options.store.listTasks(BigInt(context.chat!.id), {
      fromDate: this.today(),
      toDate: this.today(),
    });
    const priorities = tasks.filter(({ priority }) => priority === 'PRIMARY');
    await context.reply(
      priorities.length
        ? [
            '⭐ Dnešní priority',
            '',
            ...priorities.map((task) => renderTask(task)),
          ].join('\n')
        : 'Dnes nejsou vybrané žádné hlavní priority.',
    );
  }

  public async commandAdd(context: Context, raw: string): Promise<void> {
    const captures = parseTaskCaptures(raw);
    const created: BriefingTaskRecord[] = [];
    for (const capture of captures) {
      created.push(
        await this.options.store.createTask(BigInt(context.chat!.id), {
          ...capture,
          planningDate: this.today(),
        }),
      );
    }
    await context.reply(
      `Přidáno:\n${created.map((task) => renderTask(task)).join('\n')}`,
    );
  }

  public async commandComplete(context: Context, raw: string): Promise<void> {
    const match = /^(.*?)(?:\s+(\d{1,3}h(?:\d{1,2}m)?|\d{1,3}m))?$/u.exec(
      raw.trim(),
    );
    const task = await this.uniqueTask(
      context,
      match?.[1] ?? raw,
      this.today(),
    );
    if (!task) return;
    const actual = match?.[2] ? parseDurationMinutes(match[2]) : undefined;
    const updated = await this.options.store.updateTask(
      BigInt(context.chat!.id),
      task.id,
      { status: 'COMPLETED', ...(actual ? { actualMinutes: actual } : {}) },
    );
    await context.reply(`✅ Dokončeno: ${updated!.title}`);
  }

  public async commandMove(
    context: Context,
    reference: string,
    date: string,
  ): Promise<void> {
    const task = await this.uniqueTask(context, reference);
    if (!task) return;
    const moved = await this.options.store.migrateTask(
      BigInt(context.chat!.id),
      task.id,
      z.iso.date().parse(date),
      'RESCHEDULED',
    );
    await context.reply(`→ ${moved!.title} je naplánovaný na ${date}.`);
  }

  public async commandCancel(
    context: Context,
    reference: string,
  ): Promise<void> {
    const task = await this.uniqueTask(context, reference, this.today());
    if (!task) return;
    await this.options.store.migrateTask(
      BigInt(context.chat!.id),
      task.id,
      undefined,
      'CANCELLED',
    );
    await context.reply(`× Zrušeno: ${task.title}`);
  }

  public async commandEstimate(
    context: Context,
    reference: string,
    duration: string,
  ): Promise<void> {
    const task = await this.uniqueTask(context, reference, this.today());
    if (!task) return;
    const minutes = parseDurationMinutes(duration);
    await this.options.store.updateTask(BigInt(context.chat!.id), task.id, {
      estimatedMinutes: minutes,
    });
    await context.reply(
      `Odhad pro „${task.title}“: ${formatDurationMinutes(minutes)}.`,
    );
  }

  public async commandLinkGoal(
    context: Context,
    reference: string,
    goalId: number,
  ): Promise<void> {
    const task = await this.uniqueTask(context, reference, this.today());
    if (!task) return;
    const updated = await this.options.store.updateTask(
      BigInt(context.chat!.id),
      task.id,
      { goalId },
    );
    await context.reply(
      `🔗 „${updated!.title}“ je propojeno s cílem #${goalId}.`,
    );
  }

  public async commandDailyReview(context: Context): Promise<void> {
    const date = this.today();
    const session = await this.options.store.ensureSession(
      BigInt(context.chat!.id),
      BigInt(context.from!.id),
      'DAILY_REVIEW',
      date,
    );
    if (session.status === 'COMPLETED') {
      await this.options.startJournal(context);
      return;
    }
    await this.options.store.updateSession(session.id, {
      status: 'IN_PROGRESS',
      currentStep: 0,
      draft: reviewDraftSchema.parse(session.draft),
    });
    const tasks = await this.options.store.listTasks(BigInt(context.chat!.id), {
      fromDate: date,
      toDate: date,
    });
    await context.reply(
      [
        `🌙 Nejdřív krátké goal review — ${date}`,
        '',
        ...(tasks.length
          ? tasks.map((task, index) => renderTask(task, index))
          : ['Dnešní plán nemá zaznamenané úkoly.']),
        '',
        'Po review plynule naváže stávající šestibodový journal.',
      ].join('\n'),
    );
    await this.askNextReviewTask(context);
  }

  public async ensureDailyReviewBeforeJournal(
    context: Context,
  ): Promise<boolean> {
    const session = await this.options.store.getSessionForPeriod(
      BigInt(context.chat!.id),
      BigInt(context.from!.id),
      'DAILY_REVIEW',
      this.today(),
    );
    if (session?.status === 'COMPLETED') return true;
    await this.commandDailyReview(context);
    return false;
  }

  public async completeDailyAlignment(
    journal: JournalSessionRecord,
    context?: Context,
  ): Promise<void> {
    const review = await this.options.store.getReview(
      journal.telegramChatId,
      'DAILY',
      journal.journalDate,
    );
    if (!review) return;
    const tasks = await this.options.store.listTasks(journal.telegramChatId, {
      fromDate: journal.journalDate,
      toDate: journal.journalDate,
    });
    const metrics = calculateExecutionMetrics(tasks);
    const priority = journal.answers.priority.trim();
    const challenges = journal.answers.challenges.trim();
    const alignment = [
      metrics.linkedCompletedTasks > 0
        ? `Ověřeno: ${metrics.linkedCompletedTasks} dokončených úkolů mělo přímou vazbu na zaznamenaný cíl.`
        : 'U dokončených úkolů není zaznamenaná přímá vazba na cíl; to samo o sobě neznamená, že byly zbytečné.',
      challenges
        ? `Sebereflexe k překážkám: ${challenges}`
        : 'K překážkám nebyla doplněna další informace.',
      priority
        ? `Jedna explicitní úprava pro zítřek: ${priority}`
        : 'Pro zítřek nebyla zaznamenána explicitní priorita.',
    ].join('\n');
    await this.options.store.saveReview(journal.telegramChatId, {
      type: 'DAILY',
      periodStart: review.periodStart,
      periodEnd: review.periodEnd,
      answers: review.answers,
      metrics,
      ...(review.summary ? { summary: review.summary } : {}),
      alignment,
      nextPriorities: priority ? [priority] : review.nextPriorities,
      monthlyPrinciples: review.monthlyPrinciples,
      ...(review.dailyPractice ? { dailyPractice: review.dailyPractice } : {}),
    });
    await context?.reply(
      `🎯 Denní alignment je doplněný podle potvrzeného journalu. ${metrics.completedPlannedTasks}/${metrics.plannedTasks} plánovaných úkolů bylo dokončeno; zítřejší úprava: ${priority || 'není zadaná'}.`,
    );
  }

  public async commandWeeklyReview(context: Context): Promise<void> {
    const range = weekRange(this.today());
    await this.startPeriodReview(
      context,
      'WEEKLY_REVIEW',
      range.start,
      range.end,
    );
  }

  public async commandMonthlyReview(context: Context): Promise<void> {
    const range = monthRange(this.today());
    await this.startPeriodReview(
      context,
      'MONTHLY_REVIEW',
      range.start,
      range.end,
    );
  }

  public async handleText(context: Context): Promise<boolean> {
    const text = context.message?.text?.trim();
    if (!text || text.startsWith('/')) return false;
    const active = await this.options.store.getActiveSession(
      BigInt(context.chat!.id),
      BigInt(context.from!.id),
    );
    if (active?.kind === 'MORNING') {
      await this.handleMorningText(context, active, text);
      return true;
    }
    if (active?.kind === 'DAILY_REVIEW') {
      await this.handleDailyReviewText(context, active, text);
      return true;
    }
    if (active?.kind === 'WEEKLY_REVIEW' || active?.kind === 'MONTHLY_REVIEW') {
      await this.handlePeriodText(context, active, text);
      return true;
    }
    return this.handleNaturalTaskCommand(context, text);
  }

  public async handleCallback(
    context: Context,
    sessionId: string,
    action: string,
  ): Promise<void> {
    const session = await this.options.store.getSession(
      sessionId,
      BigInt(context.chat!.id),
      BigInt(context.from!.id),
    );
    if (!session) {
      await context.answerCallbackQuery('Tato volba už není platná.');
      return;
    }
    await context.answerCallbackQuery();
    if (action === 'laptop' || action === 'mirror') {
      const draft = morningDraftSchema.parse(session.draft);
      await this.options.store.updateSession(session.id, {
        draft: {
          ...draft,
          ...(action === 'laptop'
            ? { laptopCommitmentAcknowledged: true }
            : { mirrorAcknowledged: true }),
        },
      });
      await context.reply(
        action === 'laptop'
          ? '✅ Ranní závazek zaznamenán.'
          : '🪞 Ranní reflexe zaznamenána.',
      );
      return;
    }
    if (action === 'confirm') {
      if (session.kind !== 'MORNING') return;
      const draft = morningDraftSchema.parse(session.draft);
      const tasks = await this.options.store.commitMorningPlan(
        session.id,
        BigInt(context.chat!.id),
        draft.tasks.map((task) => ({
          ...task,
          planningDate: session.periodStart,
          priority: task.priority ?? 'NORMAL',
        })),
      );
      await context.reply(
        `✅ Plán je potvrzený a uložený (${tasks.length} úkolů).`,
      );
      return;
    }
    if (action === 'edit') {
      await this.options.store.updateSession(session.id, {
        status: 'IN_PROGRESS',
        currentStep: 1,
      });
      await context.reply('Pokračuj přidáním úkolů nebo napiš „hotovo“.');
    }
  }

  public async handleReviewCallback(
    context: Context,
    taskPrefix: string,
    action: string,
  ): Promise<void> {
    const active = await this.options.store.getActiveSession(
      BigInt(context.chat!.id),
      BigInt(context.from!.id),
    );
    if (!active || active.kind !== 'DAILY_REVIEW') {
      await context.answerCallbackQuery('Denní review už není aktivní.');
      return;
    }
    const task = await this.uniqueTask(
      context,
      taskPrefix,
      active.periodStart,
      true,
    );
    if (!task) return;
    await context.answerCallbackQuery();
    if (action === 'done') {
      await this.options.store.updateTask(BigInt(context.chat!.id), task.id, {
        status: 'COMPLETED',
      });
    } else if (action === 'tomorrow') {
      await this.options.store.migrateTask(
        BigInt(context.chat!.id),
        task.id,
        tomorrow(active.periodStart),
        'MIGRATED',
      );
    } else if (action === 'backlog' || action === 'cancel') {
      await this.options.store.migrateTask(
        BigInt(context.chat!.id),
        task.id,
        undefined,
        action === 'backlog' ? 'BACKLOG' : 'CANCELLED',
      );
    }
    await this.askNextReviewTask(context);
  }

  private async handleMorningText(
    context: Context,
    session: PlanningSessionRecord,
    text: string,
  ): Promise<void> {
    const draft = morningDraftSchema.parse(session.draft);
    if (session.currentStep === 0) {
      if (!/^(?:pokračovat|continue|hotovo|done)$/iu.test(text)) {
        await context.reply(
          'Nejdřív vyřeš starší úkoly; až budeš připravený, napiš „pokračovat“.',
        );
        return;
      }
      await this.options.store.updateSession(session.id, {
        currentStep: 1,
        draft,
      });
      await context.reply(
        'Napiš dnešní úkoly přirozeně, klidně ve více zprávách. Např. „Studovat algebru 1h30m, Watcher 2h a běh 45m“. Až skončíš, napiš „hotovo“.',
      );
      return;
    }
    if (session.currentStep === 1) {
      if (/^(?:hotovo|done)$/iu.test(text)) {
        if (!draft.tasks.length) {
          await context.reply(
            'Přidej alespoň jeden úkol, nebo relaci zruš přes /plan_cancel.',
          );
          return;
        }
        await this.options.store.updateSession(session.id, {
          currentStep: 2,
          draft,
        });
        await context.reply(
          `Vyber 1–3 hlavní priority čísly, např. „1, 3“:\n${draft.tasks
            .map((task, index) => `${index + 1}. ${task.title}`)
            .join('\n')}`,
        );
        return;
      }
      const captures = parseTaskCaptures(text);
      const tasks = [...draft.tasks, ...captures];
      await this.options.store.updateSession(session.id, {
        draft: { ...draft, tasks },
      });
      await context.reply(
        `Připraveno ${captures.length} úkolů. Celkem ${tasks.length}. Přidej další nebo napiš „hotovo“.`,
      );
      return;
    }
    if (session.currentStep === 2) {
      const selected = [...new Set(text.match(/\d+/gu)?.map(Number) ?? [])];
      if (
        selected.length < 1 ||
        selected.length > 3 ||
        selected.some((index) => index < 1 || index > draft.tasks.length)
      ) {
        await context.reply('Vyber 1–3 platná čísla úkolů.');
        return;
      }
      const tasks = draft.tasks.map((task, index) => ({
        ...task,
        priority: selected.includes(index + 1)
          ? ('PRIMARY' as const)
          : ('NORMAL' as const),
      }));
      await this.options.store.updateSession(session.id, {
        status: 'AWAITING_CONFIRMATION',
        currentStep: 3,
        draft: { ...draft, tasks },
      });
      await context.reply(morningSummary(tasks), {
        reply_markup: new InlineKeyboard()
          .text('✅ Potvrdit plán', `plan:${session.id}:confirm`)
          .row()
          .text('✏️ Upravit', `plan:${session.id}:edit`),
      });
    }
  }

  private async askNextReviewTask(context: Context): Promise<void> {
    const active = await this.options.store.getActiveSession(
      BigInt(context.chat!.id),
      BigInt(context.from!.id),
    );
    if (!active || active.kind !== 'DAILY_REVIEW') return;
    const tasks = await this.options.store.listTasks(BigInt(context.chat!.id), {
      fromDate: active.periodStart,
      toDate: active.periodStart,
      statuses: ['TODO', 'IN_PROGRESS'],
    });
    const task = tasks[0];
    if (!task) {
      await this.options.store.updateSession(active.id, { currentStep: 1 });
      await context.reply(
        'Zaznamenej neplánované úspěchy, které chceš odlišit od ranního plánu. Pokud žádné nebyly, napiš „nic“.',
      );
      return;
    }
    await context.reply(`Jak dopadl tento úkol?\n\n${renderTask(task)}`, {
      reply_markup: new InlineKeyboard()
        .text('✅ Hotovo', `plan:rv:${shortId(task.id)}:done`)
        .row()
        .text('→ Zítra', `plan:rv:${shortId(task.id)}:tomorrow`)
        .text('□ Backlog', `plan:rv:${shortId(task.id)}:backlog`)
        .row()
        .text('× Zrušit', `plan:rv:${shortId(task.id)}:cancel`),
    });
  }

  private async handleDailyReviewText(
    context: Context,
    session: PlanningSessionRecord,
    text: string,
  ): Promise<void> {
    const draft = reviewDraftSchema.parse(session.draft);
    if (session.currentStep === 1) {
      if (!/^(?:nic|none|žádné)$/iu.test(text)) {
        for (const capture of parseTaskCaptures(text)) {
          await this.options.store
            .createTask(BigInt(context.chat!.id), {
              ...capture,
              planningDate: session.periodStart,
              source: 'UNPLANNED',
            })
            .then((task) =>
              this.options.store.updateTask(BigInt(context.chat!.id), task.id, {
                status: 'COMPLETED',
              }),
            );
        }
      }
      await this.options.store.updateSession(session.id, {
        currentStep: 2,
        draft: { ...draft, unexpected: text },
      });
      await context.reply(
        'Co ti dnes bránilo dokončit plánované věci? Pokud nic podstatného, napiš „nic“.',
      );
      return;
    }
    if (session.currentStep === 2) {
      await this.finishDailyReview(context, session, {
        ...draft,
        blockers: text,
      });
    }
  }

  private async finishDailyReview(
    context: Context,
    session: PlanningSessionRecord,
    draft: z.infer<typeof reviewDraftSchema>,
  ): Promise<void> {
    const tasks = await this.options.store.listTasks(BigInt(context.chat!.id), {
      fromDate: session.periodStart,
      toDate: session.periodEnd,
    });
    const metrics = calculateExecutionMetrics(tasks);
    await this.options.store.saveReview(BigInt(context.chat!.id), {
      type: 'DAILY',
      periodStart: session.periodStart,
      periodEnd: session.periodEnd,
      answers: {
        unexpected: draft.unexpected,
        blockers: draft.blockers,
      },
      metrics,
      summary: `${metrics.completedPlannedTasks}/${metrics.plannedTasks} plánovaných úkolů dokončeno; ${metrics.migratedTasks} migrováno; ${metrics.unplannedCompletedTasks} neplánovaných dokončeno.`,
      alignment:
        metrics.linkedCompletedTasks > 0
          ? `${metrics.linkedCompletedTasks} dokončených úkolů mělo přímou vazbu na cíl.`
          : 'U dokončených úkolů není zaznamenaná přímá vazba na cíl; to samo o sobě neznamená, že byly zbytečné.',
    });
    await this.options.store.updateSession(session.id, {
      status: 'COMPLETED',
      currentStep: 3,
      draft,
    });
    await context.reply(
      `✅ Goal review uzavřeno. Dokončeno ${metrics.completedPlannedTasks}/${metrics.plannedTasks} plánovaných úkolů (${metrics.completionPercentage} %).\n\nTeď navazuje tvoje stávající večerní reflexe.`,
    );
    await this.options.startJournal(context);
  }

  private async startPeriodReview(
    context: Context,
    kind: 'WEEKLY_REVIEW' | 'MONTHLY_REVIEW',
    start: string,
    end: string,
  ): Promise<void> {
    const session = await this.options.store.ensureSession(
      BigInt(context.chat!.id),
      BigInt(context.from!.id),
      kind,
      start,
      end,
    );
    if (session.status === 'COMPLETED') {
      await context.reply('Toto review už je dokončené.');
      return;
    }
    const tasks = await this.options.store.listTasks(BigInt(context.chat!.id), {
      fromDate: start,
      toDate: end,
    });
    const metrics = calculateExecutionMetrics(tasks);
    await this.options.store.updateSession(session.id, {
      status: 'IN_PROGRESS',
      currentStep: session.currentStep,
      draft: reviewDraftSchema.parse(session.draft),
    });
    await context.reply(
      `${kind === 'WEEKLY_REVIEW' ? '📅 Týdenní' : '🗓️ Měsíční'} review ${start}–${end}\n\nPlánováno ${metrics.plannedTasks}, dokončeno ${metrics.completedPlannedTasks}, migrováno ${metrics.migratedTasks}.`,
    );
    await context.reply(periodQuestions[kind][session.currentStep]!);
  }

  private async handlePeriodText(
    context: Context,
    session: PlanningSessionRecord,
    text: string,
  ): Promise<void> {
    if (session.kind !== 'WEEKLY_REVIEW' && session.kind !== 'MONTHLY_REVIEW') {
      return;
    }
    const questions = periodQuestions[session.kind];
    const draft = reviewDraftSchema.parse(session.draft);
    const answers = { ...draft.answers, [String(session.currentStep)]: text };
    const next = session.currentStep + 1;
    if (next < questions.length) {
      await this.options.store.updateSession(session.id, {
        currentStep: next,
        draft: { ...draft, answers },
      });
      await context.reply(questions[next]!);
      return;
    }
    const tasks = await this.options.store.listTasks(BigInt(context.chat!.id), {
      fromDate: session.periodStart,
      toDate: session.periodEnd,
    });
    const metrics = calculateExecutionMetrics(tasks);
    await this.options.store.saveReview(BigInt(context.chat!.id), {
      type: session.kind === 'WEEKLY_REVIEW' ? 'WEEKLY' : 'MONTHLY',
      periodStart: session.periodStart,
      periodEnd: session.periodEnd,
      answers,
      metrics,
      summary: `${metrics.completedPlannedTasks}/${metrics.plannedTasks} plánovaných úkolů dokončeno.`,
      nextPriorities: [answers[String(questions.length - 2)] ?? ''].filter(
        Boolean,
      ),
      ...(session.kind === 'MONTHLY_REVIEW'
        ? {
            monthlyPrinciples: text
              .split(/\n|;/u)
              .map((value) => value.trim())
              .filter(Boolean),
          }
        : { dailyPractice: text }),
    });
    await this.options.store.updateSession(session.id, {
      status: 'COMPLETED',
      currentStep: next,
      draft: { ...draft, answers },
    });
    await context.reply(
      '✅ Review je uložené. Navržené priority zůstávají návrhem; nové goals vzniknou až po tvém výslovném potvrzení přes goal commands.',
    );
  }

  private async handleNaturalTaskCommand(
    context: Context,
    text: string,
  ): Promise<boolean> {
    if (
      /^(?:show my remaining tasks|ukaž (?:mi )?(?:zbývající )?úkoly)/iu.test(
        text,
      )
    ) {
      await this.commandTasks(context);
      return true;
    }
    if (
      /^(?:what are my priorities today|jaké jsou (?:dnes )?priority)/iu.test(
        text,
      )
    ) {
      await this.commandPriorities(context);
      return true;
    }
    const complete =
      /^(?:mark|označ)\s+(.+?)\s+(?:as completed|jako hotov(?:é|ý)|za hotov(?:é|ý))\.?$/iu.exec(
        text,
      );
    if (complete) {
      await this.commandComplete(context, complete[1]!);
      return true;
    }
    const add = /^(?:add|přidej)\s+(.+)$/iu.exec(text);
    if (add) {
      await this.commandAdd(context, add[1]!);
      return true;
    }
    const move =
      /^(?:move|přesuň)\s+(.+?)\s+(?:to tomorrow|na zítra)\.?$/iu.exec(text);
    if (move) {
      await this.commandMove(context, move[1]!, tomorrow(this.today()));
      return true;
    }
    const estimate =
      /^(?:change|změň)\s+(.+?)\s+(?:estimate|odhad)\s+(?:to|na)\s+(\S+)\.?$/iu.exec(
        text,
      );
    if (estimate) {
      await this.commandEstimate(context, estimate[1]!, estimate[2]!);
      return true;
    }
    const cancel = /^(?:cancel|zruš)\s+(.+?)\.?$/iu.exec(text);
    if (cancel) {
      await this.commandCancel(context, cancel[1]!);
      return true;
    }
    return false;
  }

  private async uniqueTask(
    context: Context,
    reference: string,
    date?: string,
    callback = false,
  ): Promise<BriefingTaskRecord | undefined> {
    const matches = await this.options.store.resolveTask(
      BigInt(context.chat!.id),
      reference.trim(),
      date,
    );
    if (matches.length === 1) return matches[0];
    const message = matches.length
      ? `Odkaz je nejednoznačný. Použij ID:\n${matches.map((task) => renderTask(task)).join('\n')}`
      : 'Takový úkol jsem nenašel.';
    if (callback) await context.answerCallbackQuery(message.slice(0, 180));
    else await context.reply(message);
    return undefined;
  }

  private today(): string {
    return todayDateInTimezone(
      this.options.now?.() ?? new Date(),
      this.options.timezone,
    );
  }
}
