import {
  type JournalSessionRecord,
  type JournalSessionStore,
} from '@watcher/database';
import type { WatcherLogger } from '@watcher/core';
import { splitTelegramMessage } from '@watcher/telegram';
import { InlineKeyboard, type Context } from 'grammy';
import {
  JournalContentConflictError,
  journalSectionHeadings,
  todayDateInTimezone,
  type JournalSection,
  type NotionJournalRepository,
} from './notion-journal.js';
import type { JournalDraftGenerator } from './journal-draft.js';
import type { JournalTranscriber } from './journal-transcriber.js';

const sections = Object.keys(journalSectionHeadings) as JournalSection[];
const callback = (id: string, action: string): string =>
  `journal:${id}:${action}`;

export const journalReminderText =
  '🌙 Je čas na večerní reflexi.\n\nPojďme si krátce projít dnešní den. Zabere to jen pár minut.';

export const journalReminderKeyboard = (id: string): InlineKeyboard =>
  new InlineKeyboard()
    .text('📝 Začít reflexi', callback(id, 'text'))
    .row()
    .text('🎙️ Hlasová reflexe', callback(id, 'voice'))
    .row()
    .text('⏰ Připomenout později', callback(id, 'later'))
    .row()
    .text('⏭️ Dnes vynechat', callback(id, 'skipday'));

const questionKeyboard = (session: JournalSessionRecord): InlineKeyboard => {
  const keyboard = new InlineKeyboard();
  if (session.currentQuestion > 0) {
    keyboard.text('⬅️ Zpět', callback(session.id, 'back'));
  }
  keyboard.text('⏭️ Přeskočit', callback(session.id, 'skip')).row();
  return keyboard.text('✖️ Zrušit', callback(session.id, 'cancel'));
};

const previewKeyboard = (id: string): InlineKeyboard =>
  new InlineKeyboard()
    .text('✅ Uložit do Notionu', callback(id, 'save'))
    .row()
    .text('✏️ Upravit', callback(id, 'edit'))
    .row()
    .text('🔄 Nahrát znovu', callback(id, 'rerecord'))
    .row()
    .text('❌ Zrušit', callback(id, 'cancel'));

const editKeyboard = (id: string): InlineKeyboard => {
  const keyboard = new InlineKeyboard();
  sections.forEach((section, index) => {
    keyboard.text(`${index + 1}`, callback(id, `edit${section}`));
    if (index % 3 === 2) keyboard.row();
  });
  return keyboard;
};

const czechDate = (date: string): string => {
  const [year, month, day] = date.split('-');
  return `${Number(day)}. ${Number(month)}. ${year}`;
};

const renderPreview = (session: JournalSessionRecord): string =>
  [
    `📓 Denní reflexe — ${czechDate(session.journalDate)}`,
    ...sections.map(
      (section) =>
        `\n${journalSectionHeadings[section]}\n${session.answers[section] || '— přeskočeno —'}`,
    ),
    '\nZkontroluj text. Do Notion se uloží až po potvrzení.',
  ].join('\n');

const unfinished = (session: JournalSessionRecord | undefined): boolean =>
  Boolean(
    session &&
    [
      'REMINDER_PENDING',
      'IN_PROGRESS',
      'AWAITING_CONFIRMATION',
      'CANCELLED',
    ].includes(session.status),
  );

const statusLabels: Record<JournalSessionRecord['status'], string> = {
  REMINDER_PENDING: 'čeká na zahájení',
  IN_PROGRESS: 'rozpracováno',
  AWAITING_CONFIRMATION: 'čeká na potvrzení',
  COMPLETED: 'dokončeno',
  SKIPPED: 'vynecháno',
  CANCELLED: 'zrušeno',
};

const syncLabels: Record<JournalSessionRecord['syncStatus'], string> = {
  NOT_READY: 'zatím není připraveno',
  PENDING: 'čeká na uložení',
  SYNCED: 'uloženo v Notionu',
  FAILED: 'čeká na další pokus',
  CONFLICT: 'konflikt s ruční úpravou',
};

export type JournalControllerOptions = {
  store: JournalSessionStore;
  timezone: string;
  token: string;
  repository?: NotionJournalRepository;
  transcriber?: JournalTranscriber;
  drafts: JournalDraftGenerator;
  logger?: WatcherLogger;
  now?: () => Date;
  fetch?: typeof fetch;
};

export class JournalController {
  public constructor(private readonly options: JournalControllerOptions) {}

  public async commandStart(context: Context): Promise<void> {
    const session = await this.current(context);
    if (session.status === 'COMPLETED' && session.syncStatus !== 'SYNCED') {
      await this.preview(context, session);
      return;
    }
    if (session.status === 'COMPLETED' || session.status === 'SKIPPED') {
      await context.reply('Dnešní reflexe už je uzavřená.');
      return;
    }
    if (session.status === 'AWAITING_CONFIRMATION') {
      await this.preview(context, session);
      return;
    }
    const started = await this.options.store.start(
      session.id,
      session.mode ?? 'TEXT',
    );
    if (started.mode === 'VOICE') await this.askForVoice(context, started);
    else await this.askQuestion(context, started);
  }

  public async commandReminderTest(context: Context): Promise<void> {
    const session = await this.current(context);
    if (session.status === 'COMPLETED' || session.status === 'SKIPPED') {
      await context.reply('Dnešní reflexe už je uzavřená.');
      return;
    }
    await context.reply(journalReminderText, {
      reply_markup: journalReminderKeyboard(session.id),
    });
  }

  public async commandStatus(context: Context): Promise<void> {
    const session = await this.options.store.getLatest(
      BigInt(context.chat!.id),
      BigInt(context.from!.id),
    );
    if (!session) {
      await context.reply(
        'Zatím nemáš žádnou dnešní reflexi. Začni pomocí /journal.',
      );
      return;
    }
    const completed = sections.filter((key) =>
      session.answers[key].trim(),
    ).length;
    await context.reply(
      `📓 Reflexe ${czechDate(session.journalDate)}\nStav: ${statusLabels[session.status]}\nVyplněno: ${completed}/6\nSynchronizace: ${syncLabels[session.syncStatus]}`,
    );
  }

  public async commandCancel(context: Context): Promise<void> {
    const session = await this.options.store.getLatest(
      BigInt(context.chat!.id),
      BigInt(context.from!.id),
    );
    if (!session || !unfinished(session)) {
      await context.reply('Není tu rozpracovaná reflexe ke zrušení.');
      return;
    }
    await this.options.store.setStatus(session.id, 'CANCELLED');
    await context.reply(
      'Reflexe je zrušená. Dosavadní odpovědi zůstaly bezpečně uložené.',
    );
  }

  public async handleText(context: Context): Promise<boolean> {
    const text = context.message?.text?.trim();
    if (!text || text.startsWith('/')) return false;
    const session = await this.options.store.getLatest(
      BigInt(context.chat!.id),
      BigInt(context.from!.id),
    );
    if (
      !session ||
      session.status !== 'IN_PROGRESS' ||
      session.mode !== 'TEXT'
    ) {
      return false;
    }
    await this.saveAnswer(context, session, text);
    return true;
  }

  public async handleVoice(context: Context): Promise<boolean> {
    const voice = context.message?.voice;
    if (!voice) return false;
    const session = await this.options.store.getLatest(
      BigInt(context.chat!.id),
      BigInt(context.from!.id),
    );
    if (!session || session.status !== 'IN_PROGRESS') return false;
    if (!this.options.transcriber) {
      await context.reply(
        'Přepis hlasu není na tomto serveru nakonfigurovaný. Můžeš pokračovat textem.',
      );
      return true;
    }
    if (voice.file_size && voice.file_size > 20 * 1024 * 1024) {
      await context.reply('Hlasová zpráva je příliš velká. Limit je 20 MB.');
      return true;
    }
    const status = await context.reply('🎧 Přepisuji hlasovou zprávu…');
    try {
      const file = await context.api.getFile(voice.file_id);
      if (!file.file_path) throw new Error('Telegram nevrátil cestu k souboru');
      const response = await (this.options.fetch ?? fetch)(
        `https://api.telegram.org/file/bot${this.options.token}/${file.file_path}`,
        { signal: AbortSignal.timeout(60_000) },
      );
      if (!response.ok)
        throw new Error(`Stažení hlasu selhalo (${response.status})`);
      const audio = await response.blob();
      const transcript = await this.options.transcriber.transcribe(
        audio,
        'journal.ogg',
        AbortSignal.timeout(180_000),
      );
      if (session.mode === 'TEXT') {
        await this.saveAnswer(context, session, transcript);
      } else {
        const draft = await this.options.drafts.generate(
          transcript,
          AbortSignal.timeout(180_000),
        );
        const updated = await this.options.store.saveVoiceDraft(
          session.id,
          transcript,
          draft,
        );
        await this.preview(context, updated);
      }
      await context.api
        .deleteMessage(context.chat!.id, status.message_id)
        .catch(() => undefined);
    } catch (error) {
      this.options.logger?.warn(
        { err: error, journalSessionId: session.id },
        'Journal voice processing failed',
      );
      await context.reply(
        'Hlasovou zprávu se nepodařilo zpracovat. Zkus to znovu nebo použij text.',
      );
    }
    return true;
  }

  public async handleCallback(
    context: Context,
    id: string,
    action: string,
  ): Promise<void> {
    const session = await this.options.store.getById(
      id,
      BigInt(context.chat!.id),
      BigInt(context.from!.id),
    );
    if (!session) {
      await context.answerCallbackQuery('Tato volba už není platná.');
      return;
    }
    if (
      session.status === 'SKIPPED' ||
      (session.status === 'COMPLETED' && action !== 'save')
    ) {
      await context.answerCallbackQuery('Tato reflexe už je uzavřená.');
      return;
    }
    await context.answerCallbackQuery();
    if (['skip', 'back'].includes(action) && session.status !== 'IN_PROGRESS') {
      await context.reply(
        'Tato otázka už není aktuální. Pokračuj přes /journal.',
      );
      return;
    }
    if (
      (action === 'edit' || action.startsWith('edit')) &&
      session.status !== 'AWAITING_CONFIRMATION'
    ) {
      await context.reply(
        'Tento náhled už není aktuální. Pokračuj přes /journal.',
      );
      return;
    }
    if (
      action === 'save' &&
      !['AWAITING_CONFIRMATION', 'COMPLETED'].includes(session.status)
    ) {
      await context.reply('Reflexe ještě není připravená k uložení.');
      return;
    }
    if (action === 'text') {
      await this.askQuestion(
        context,
        await this.options.store.start(id, 'TEXT'),
      );
    } else if (action === 'voice' || action === 'rerecord') {
      await this.askForVoice(
        context,
        await this.options.store.start(id, 'VOICE'),
      );
    } else if (action === 'later') {
      await this.options.store.postpone(
        id,
        new Date(this.now().getTime() + 30 * 60_000),
      );
      await context.reply('⏰ Připomenu se za 30 minut.');
    } else if (action === 'skipday') {
      await this.options.store.setStatus(id, 'SKIPPED');
      await context.reply('Dnešní reflexi vynechávám. Zítra se ozvu znovu.');
    } else if (action === 'skip') {
      await this.saveAnswer(context, session, '');
    } else if (action === 'back') {
      const updated = await this.options.store.saveProgress(
        id,
        session.answers,
        Math.max(0, session.currentQuestion - 1),
        'IN_PROGRESS',
        {
          currentQuestion: session.currentQuestion,
          status: 'IN_PROGRESS',
        },
      );
      await this.askQuestion(context, updated);
    } else if (action === 'save') {
      const confirmed = await this.options.store.confirm(id);
      await context.reply('✅ Reflexe je potvrzená. Ukládám ji do Notion.');
      await this.synchronize(confirmed, context);
    } else if (action === 'edit') {
      await context.reply('Kterou odpověď chceš upravit?', {
        reply_markup: editKeyboard(id),
      });
    } else if (action.startsWith('edit')) {
      const key = action.slice(4) as JournalSection;
      const index = sections.indexOf(key);
      if (index < 0) return;
      const updated = await this.options.store.saveProgress(
        id,
        session.answers,
        index,
        'IN_PROGRESS',
        {
          currentQuestion: session.currentQuestion,
          status: 'AWAITING_CONFIRMATION',
        },
      );
      await this.options.store.start(id, 'TEXT');
      await this.askQuestion(context, { ...updated, mode: 'TEXT' });
    } else if (action === 'cancel') {
      await this.options.store.setStatus(id, 'CANCELLED');
      await context.reply(
        'Reflexe je zrušená. Odpovědi zůstaly uložené pro případné pokračování.',
      );
    }
  }

  public async synchronize(
    session: JournalSessionRecord,
    context?: Context,
  ): Promise<{ pageUrl?: string } | undefined> {
    if (!this.options.repository) {
      await this.options.store.markSyncFailure(
        session.id,
        'Notion není nakonfigurovaný',
      );
      if (context)
        await context.reply(
          'Notion není nakonfigurovaný. Reflexe zůstala uložená lokálně.',
        );
      return undefined;
    }
    try {
      const entry = await this.options.repository.saveConfirmed(
        session.journalDate,
        session.answers,
        session.syncedAnswers,
        AbortSignal.timeout(30_000),
      );
      await this.options.store.markSynced(
        session.id,
        {
          pageId: entry.pageId,
          ...(entry.pageUrl ? { pageUrl: entry.pageUrl } : {}),
        },
        session.answers,
      );
      if (context) {
        await context.reply(
          `✅ Hotovo! Dnešní reflexe je uložená v Notionu.\n\nZítra ráno se k důležitým poznatkům vrátíme v briefingu.${entry.pageUrl ? `\n\n${entry.pageUrl}` : ''}`,
        );
      }
      return entry.pageUrl ? { pageUrl: entry.pageUrl } : {};
    } catch (error) {
      const conflict = error instanceof JournalContentConflictError;
      await this.options.store.markSyncFailure(
        session.id,
        error instanceof Error ? error.message : String(error),
        conflict,
      );
      if (context) {
        await context.reply(
          conflict
            ? '⚠️ Záznam v Notion byl ručně upraven. Nic jsem nepřepsal; vyřeš konflikt a potvrď uložení znovu.'
            : '⚠️ Notion je dočasně nedostupný. Reflexe je uložená lokálně a synchronizaci zkusím znovu.',
        );
      }
      return undefined;
    }
  }

  private async current(context: Context): Promise<JournalSessionRecord> {
    const chatId = BigInt(context.chat!.id);
    const userId = BigInt(context.from!.id);
    const latest = await this.options.store.getLatest(chatId, userId);
    if (unfinished(latest)) return latest!;
    const now = this.now();
    return this.options.store.ensure(
      chatId,
      userId,
      todayDateInTimezone(now, this.options.timezone),
      now,
    );
  }

  private async saveAnswer(
    context: Context,
    session: JournalSessionRecord,
    answer: string,
  ): Promise<void> {
    const key = sections[session.currentQuestion];
    if (!key) return;
    const answers = { ...session.answers, [key]: answer.trim() };
    const next = session.currentQuestion + 1;
    const updated = await this.options.store.saveProgress(
      session.id,
      answers,
      Math.min(next, sections.length - 1),
      next >= sections.length ? 'AWAITING_CONFIRMATION' : 'IN_PROGRESS',
      {
        currentQuestion: session.currentQuestion,
        status: 'IN_PROGRESS',
      },
    );
    if (next >= sections.length) await this.preview(context, updated);
    else await this.askQuestion(context, updated);
  }

  private async askQuestion(
    context: Context,
    session: JournalSessionRecord,
  ): Promise<void> {
    const key = sections[session.currentQuestion] ?? sections[0]!;
    await context.reply(
      `📓 Otázka ${session.currentQuestion + 1}/6\n\n${journalSectionHeadings[key]}${
        session.answers[key]
          ? `\n\nAktuální odpověď: ${session.answers[key].slice(0, 1_000)}${session.answers[key].length > 1_000 ? '…' : ''}`
          : ''
      }`,
      { reply_markup: questionKeyboard(session) },
    );
  }

  private async askForVoice(
    context: Context,
    session: JournalSessionRecord,
  ): Promise<void> {
    await context.reply(
      '🎙️ Povídej mi o svém dni.\n\nCo se stalo, co ti udělalo radost, co se nepovedlo, co ses naučil a na co se chceš zítra soustředit?\n\nNemusíš dodržovat žádnou strukturu. Prostě mluv.',
      {
        reply_markup: new InlineKeyboard().text(
          '✖️ Zrušit',
          callback(session.id, 'cancel'),
        ),
      },
    );
  }

  private async preview(
    context: Context,
    session: JournalSessionRecord,
  ): Promise<void> {
    const messages = splitTelegramMessage(renderPreview(session));
    for (const [index, message] of messages.entries()) {
      await context.reply(message, {
        ...(index === messages.length - 1
          ? { reply_markup: previewKeyboard(session.id) }
          : {}),
      });
    }
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}
