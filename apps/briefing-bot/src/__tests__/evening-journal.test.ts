import type {
  JournalSessionRecord,
  JournalSessionStore,
} from '@watcher/database';
import { authorizationMiddleware } from '@watcher/telegram';
import { describe, expect, it, vi } from 'vitest';
import type { Context } from 'grammy';
import { JournalDraftGenerator } from '../journal-draft.js';
import {
  JournalController,
  journalReminderKeyboard,
  journalReminderText,
} from '../journal-controller.js';
import { JournalScheduler } from '../journal-scheduler.js';
import { OpenAiCompatibleJournalTranscriber } from '../journal-transcriber.js';
import type { NotionJournalRepository } from '../notion-journal.js';

const session = (): JournalSessionRecord => ({
  id: '4b2372c5-d7a4-41e0-a3c8-62943bf47289',
  telegramChatId: 123n,
  telegramUserId: 123n,
  journalDate: '2026-10-12',
  status: 'REMINDER_PENDING',
  currentQuestion: 0,
  answers: {
    experienced: '',
    joy: '',
    challenges: '',
    learned: '',
    changes: '',
    priority: '',
  },
  reminderAt: new Date('2026-10-12T19:00:00.000Z'),
  syncStatus: 'NOT_READY',
  syncAttempts: 0,
});

describe('evening journal reminder', () => {
  it('stops unauthorized Telegram users before journal handlers run', async () => {
    const reply = vi.fn();
    const next = vi.fn();
    const middleware = authorizationMiddleware(new Set([123]));

    await middleware(
      {
        from: { id: 999 },
        message: { text: '/journal' },
        reply,
      } as unknown as Context,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith('Unauthorized.');
  });

  it('renders the exact Czech prompt and four decisions', () => {
    expect(journalReminderText).toBe(
      '🌙 Je čas na večerní reflexi.\n\nPojďme si krátce projít dnešní den. Zabere to jen pár minut.',
    );
    expect(
      journalReminderKeyboard(session().id)
        .inline_keyboard.flat()
        .map(({ text }) => text),
    ).toEqual([
      '📝 Začít reflexi',
      '🎙️ Hlasová reflexe',
      '⏰ Připomenout později',
      '⏭️ Dnes vynechat',
    ]);
  });

  it('claims and acknowledges one reminder and retries pending sync', async () => {
    const due = session();
    const syncing = {
      ...session(),
      status: 'COMPLETED' as const,
      syncStatus: 'PENDING' as const,
    };
    const markReminderSent = vi.fn().mockResolvedValue(undefined);
    const store = {
      claimDueReminders: vi.fn().mockResolvedValue([due]),
      markReminderSent,
      releaseReminder: vi.fn().mockResolvedValue(undefined),
      listDueSync: vi.fn().mockResolvedValue([syncing]),
    } as unknown as JournalSessionStore;
    const deliver = vi.fn().mockResolvedValue(undefined);
    const synchronize = vi.fn().mockResolvedValue(undefined);
    const scheduler = new JournalScheduler(store, deliver, synchronize, {
      enabled: true,
      reminderTime: '21:00',
      timezone: 'Europe/Prague',
      intervalMs: 30_000,
    });

    await scheduler.tick(new Date('2026-10-12T19:01:00.000Z'));

    expect(deliver).toHaveBeenCalledWith(due);
    expect(markReminderSent).toHaveBeenCalledWith(
      due.id,
      new Date('2026-10-12T19:01:00.000Z'),
    );
    expect(synchronize).toHaveBeenCalledWith(syncing);
  });
});

describe('voice journal structuring', () => {
  it('marks the transcript untrusted and forbids invented content', async () => {
    const generateStructured = vi.fn().mockResolvedValue({
      experienced: 'Šel jsem na procházku.',
      joy: '',
      challenges: '',
      learned: '',
      changes: '',
      priority: '',
    });
    const generator = new JournalDraftGenerator({ generateStructured });

    await generator.generate('Šel jsem na procházku.');

    const prompt = generateStructured.mock.calls[0]?.[0] as string;
    expect(prompt).toContain('Nic nevymýšlej ani nedoplňuj');
    expect(prompt).toContain('nedůvěryhodný obsah');
    expect(prompt).toContain('<PŘEPIS>');
  });

  it('sends audio to the configured transcription endpoint without writing a file', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: '  Přepsaný den.  ' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const transcriber = new OpenAiCompatibleJournalTranscriber({
      url: 'http://transcriber.test/v1/audio/transcriptions',
      model: 'whisper-1',
      apiKey: 'secret',
      fetch: fetcher,
    });

    await expect(
      transcriber.transcribe(new Blob(['voice']), 'journal.ogg'),
    ).resolves.toBe('Přepsaný den.');
    const request = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(request.headers).toEqual({ Authorization: 'Bearer secret' });
    expect(request.body).toBeInstanceOf(FormData);
  });
});

describe('journal conversation state', () => {
  it('persists all six text answers before showing confirmation', async () => {
    let current: JournalSessionRecord = {
      ...session(),
      mode: 'TEXT',
      status: 'IN_PROGRESS',
    };
    const saveProgress = vi.fn(
      async (
        _id: string,
        answers: JournalSessionRecord['answers'],
        currentQuestion: number,
        status: 'IN_PROGRESS' | 'AWAITING_CONFIRMATION',
      ) => {
        current = { ...current, answers, currentQuestion, status };
        return current;
      },
    );
    const store = {
      getActiveInteraction: vi.fn(async () => current),
      saveProgress,
    } as unknown as JournalSessionStore;
    const replies: string[] = [];
    const context = {
      chat: { id: 123 },
      from: { id: 123 },
      message: { text: '' },
      reply: vi.fn(async (text: string) => {
        replies.push(text);
        return {};
      }),
    } as unknown as Context;
    const controller = new JournalController({
      store,
      timezone: 'Europe/Prague',
      token: 'token',
      drafts: {} as JournalDraftGenerator,
    });

    for (let index = 1; index <= 6; index += 1) {
      (context.message as { text?: string }).text = `Odpověď ${index}`;
      await controller.handleText(context);
    }

    expect(saveProgress).toHaveBeenCalledTimes(6);
    expect(current.status).toBe('AWAITING_CONFIRMATION');
    expect(current.answers.priority).toBe('Odpověď 6');
    expect(replies.at(-1)).toContain('📓 Denní reflexe');
  });

  it('continues the active reflection after midnight despite a newer daily session', async () => {
    const active = {
      ...session(),
      journalDate: '2026-10-22',
      mode: 'TEXT' as const,
      status: 'IN_PROGRESS' as const,
      currentQuestion: 2,
    };
    const nextDay = {
      ...session(),
      id: 'a31da473-b70f-4837-9aa6-ad08753d9f15',
      journalDate: '2026-10-23',
    };
    const saveProgress = vi.fn(async () => ({
      ...active,
      currentQuestion: 3,
      answers: { ...active.answers, challenges: 'Vyřešil jsem incident.' },
    }));
    const getActiveInteraction = vi.fn(async () => active);
    const getLatest = vi.fn(async () => nextDay);
    const store = {
      getActiveInteraction,
      getLatest,
      saveProgress,
    } as unknown as JournalSessionStore;
    const reply = vi.fn();
    const context = {
      chat: { id: 123 },
      from: { id: 123 },
      message: { text: 'Vyřešil jsem incident.' },
      reply,
    } as unknown as Context;
    const controller = new JournalController({
      store,
      timezone: 'Europe/Prague',
      token: 'token',
      drafts: {} as JournalDraftGenerator,
      now: () => new Date('2026-10-22T22:05:00.000Z'),
    });

    await expect(controller.handleText(context)).resolves.toBe(true);

    expect(getActiveInteraction).toHaveBeenCalledWith(123n, 123n);
    expect(getLatest).not.toHaveBeenCalled();
    expect(saveProgress).toHaveBeenCalledWith(
      active.id,
      { ...active.answers, challenges: 'Vyřešil jsem incident.' },
      3,
      'IN_PROGRESS',
      { currentQuestion: 2, status: 'IN_PROGRESS' },
    );
    expect(reply.mock.calls.at(-1)?.[0]).toContain('Otázka 4/6');
  });

  it('does not confirm a journal from a stale pre-preview callback', async () => {
    const confirm = vi.fn();
    const store = {
      getById: vi.fn(async () => ({
        ...session(),
        mode: 'TEXT' as const,
        status: 'IN_PROGRESS' as const,
      })),
      confirm,
    } as unknown as JournalSessionStore;
    const reply = vi.fn();
    const context = {
      chat: { id: 123 },
      from: { id: 123 },
      answerCallbackQuery: vi.fn(),
      reply,
    } as unknown as Context;
    const controller = new JournalController({
      store,
      timezone: 'Europe/Prague',
      token: 'token',
      drafts: {} as JournalDraftGenerator,
    });

    await controller.handleCallback(context, session().id, 'save');

    expect(confirm).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      'Reflexe ještě není připravená k uložení.',
    );
  });

  it('runs post-journal alignment after confirmation without changing the journal flow', async () => {
    const confirmed = {
      ...session(),
      status: 'COMPLETED' as const,
      syncStatus: 'PENDING' as const,
    };
    const onConfirmed = vi.fn().mockResolvedValue(undefined);
    const markSynced = vi.fn().mockResolvedValue(undefined);
    const store = {
      getById: vi.fn(async () => ({
        ...session(),
        status: 'AWAITING_CONFIRMATION' as const,
      })),
      confirm: vi.fn().mockResolvedValue(confirmed),
      markSynced,
    } as unknown as JournalSessionStore;
    const repository = {
      saveConfirmed: vi.fn().mockResolvedValue({ pageId: 'journal-page' }),
    } as unknown as NotionJournalRepository;
    const context = {
      chat: { id: 123 },
      from: { id: 123 },
      answerCallbackQuery: vi.fn(),
      reply: vi.fn(),
    } as unknown as Context;
    const controller = new JournalController({
      store,
      timezone: 'Europe/Prague',
      token: 'token',
      drafts: {} as JournalDraftGenerator,
      repository,
      onConfirmed,
    });

    await controller.handleCallback(context, confirmed.id, 'save');

    expect(onConfirmed).toHaveBeenCalledWith(confirmed, context);
    expect(markSynced).toHaveBeenCalled();
  });

  it('persists a 30-minute postponement and a skipped day', async () => {
    const latest = session();
    const postpone = vi.fn();
    const setStatus = vi.fn();
    const store = {
      getById: vi.fn(async () => latest),
      postpone,
      setStatus,
    } as unknown as JournalSessionStore;
    const context = {
      chat: { id: 123 },
      from: { id: 123 },
      answerCallbackQuery: vi.fn(),
      reply: vi.fn(),
    } as unknown as Context;
    const now = new Date('2026-10-12T19:10:00.000Z');
    const controller = new JournalController({
      store,
      timezone: 'Europe/Prague',
      token: 'token',
      drafts: {} as JournalDraftGenerator,
      now: () => now,
    });

    await controller.handleCallback(context, latest.id, 'later');
    await controller.handleCallback(context, latest.id, 'skipday');

    expect(postpone).toHaveBeenCalledWith(
      latest.id,
      new Date('2026-10-12T19:40:00.000Z'),
    );
    expect(setStatus).toHaveBeenCalledWith(latest.id, 'SKIPPED');
  });

  it('retains a confirmed entry locally when Notion fails', async () => {
    const completed = {
      ...session(),
      status: 'COMPLETED' as const,
      syncStatus: 'PENDING' as const,
    };
    const markSyncFailure = vi.fn();
    const store = { markSyncFailure } as unknown as JournalSessionStore;
    const repository = {
      saveConfirmed: vi.fn().mockRejectedValue(new Error('Notion unavailable')),
    } as unknown as NotionJournalRepository;
    const controller = new JournalController({
      store,
      timezone: 'Europe/Prague',
      token: 'token',
      drafts: {} as JournalDraftGenerator,
      repository,
    });

    await controller.synchronize(completed);

    expect(markSyncFailure).toHaveBeenCalledWith(
      completed.id,
      'Notion unavailable',
      false,
    );
  });
});
