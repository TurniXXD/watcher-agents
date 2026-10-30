import {
  authorizationMiddleware,
  commandArgument,
  splitTelegramMessage,
} from '@watcher/telegram';
import { InputFile, InlineKeyboard, Bot, type Api, type Context } from 'grammy';
import { randomUUID } from 'node:crypto';
import type { StudyStore } from '@watcher/database';
import type { StudyStorage } from './storage/s3-storage.js';
import type { StudyService, StudyTransport } from './study-service.js';
import type {
  BookListFilter,
  BookRecord,
  StudyBookLibrary,
} from './book-library.js';
import { bookCategories, type BookDraft } from './book-metadata.js';
import { z } from 'zod';

const bookTitleInputSchema = z.string().trim().min(1).max(300);
const bookAuthorInputSchema = z.string().trim().min(1).max(300);
const bookCategoryInputSchema = z.enum(bookCategories);

export const studyCommands = [
  { command: 'start', description: 'Open Study Bot and show its guide' },
  { command: 'help', description: 'Show commands and examples' },
  { command: 'about', description: 'Explain data flows and limitations' },
  { command: 'status', description: 'Show the latest PDF study job' },
  { command: 'cancel', description: 'Cancel the latest active PDF job' },
  { command: 'book_add', description: 'Find and confirm a book for Notion' },
  { command: 'books', description: 'List the Notion book library' },
  { command: 'books_category', description: 'List books in one category' },
  { command: 'books_author', description: 'List books by author' },
  { command: 'books_next', description: 'List books marked Next to read' },
  { command: 'books_favorites', description: 'List favorite books only' },
  { command: 'books_categories', description: 'List available categories' },
  { command: 'books_authors', description: 'List available authors' },
] as const;

export const studyHelp = `📚 Study bot

Send a text-based PDF and I will create a source-grounded spoken lecture. Scanned PDFs need OCR first.

/start — initialize the bot and show this guide
/about — purpose, data flow, grounding, and safety boundaries
/status — latest document job
/cancel — cancel latest running job
/book_add TITLE — find book metadata and ask before saving to Notion
/books — list all books
/books_category CATEGORY — filter by category; example: /books_category Biologie
/books_author AUTHOR — filter by author; example: /books_author Richard Feynman
/books_next — list books marked Next to read
/books_favorites — list favorite books only
/books_categories — list available categories
/books_authors — list available authors
/help — this help`;

export const studyAbout = `📚 About Study Bot

Study Bot is a private assistant for turning text-based university PDFs into source-grounded spoken lectures, summaries, quizzes, and Anki-compatible flashcards. It stores the uploaded source and generated media in configured S3-compatible storage, extracts page text, and routes bounded evidence through the shared Ollama queue before Piper creates audio.

Generated facts, questions, and cards retain source-page references. Scanned or near-empty PDFs are rejected with an OCR-required message instead of being guessed from. Jobs persist their stages and cancellation takes effect at safe boundaries.

The optional book-library commands search public Open Library metadata, show the proposed author/category/genre/page data for explicit confirmation, and then write one record to the configured Notion Learning/Books database. PostgreSQL keeps expiring confirmation drafts so restarts do not bypass confirmation. Notion remains authoritative for saved books and their read, priority, next-to-read, and favorite flags.

The bot does not browse for replacement PDF facts, invent missing source material, create a book without confirmation, or share documents with unauthorized Telegram users. Upload a PDF or use /book_add TITLE; use /help for all commands.`;

const statusLabel: Record<string, string> = {
  RECEIVED: 'received',
  EXTRACTING: 'extracting text',
  ANALYZING: 'analyzing source chunks',
  OUTLINING: 'building outline',
  GENERATING_LECTURE: 'writing lecture',
  GENERATING_AUDIO: 'generating audio',
  SENDING: 'sending lecture',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

const actions = (jobId: string): InlineKeyboard =>
  new InlineKeyboard()
    .text('🎧 Full lecture', `study:full:${jobId}`)
    .text('⚡ Quick summary', `study:summary:${jobId}`)
    .row()
    .text('🧠 Quiz', `study:quiz:${jobId}`)
    .text('📄 Text summary', `study:summary:${jobId}`)
    .row()
    .text('🗂 Anki flashcards', `study:anki:${jobId}`);

const bookConfirmation = (draftId: string): InlineKeyboard =>
  new InlineKeyboard()
    .text('✅ Save to Notion', `study:book:confirm:${draftId}`)
    .text('❌ Cancel', `study:book:cancel:${draftId}`);

export const renderBookDraft = (draft: BookDraft): string =>
  [
    '📚 Confirm book',
    '',
    `Title: ${draft.title}`,
    `Author: ${draft.author || 'unknown'}`,
    `Categories: ${draft.categories.join(', ') || 'none'}`,
    `Genre: ${draft.genre}`,
    `Pages: ${draft.pages ?? 'unknown'}`,
    `Complexity: ${draft.complexity}`,
    `Priority: ${draft.priority ? 'yes' : 'no'}`,
    `Read: ${draft.read ? 'yes' : 'no'}`,
    `Next to read: ${draft.nextToRead ? 'yes' : 'no'}`,
    `Favorite: ${draft.favorite ? 'yes' : 'no'}`,
    `Source: ${draft.sourceUrl}`,
    '',
    'Nothing is saved until you confirm.',
  ].join('\n');

export const renderBooks = (
  books: readonly BookRecord[],
  label: string,
): string => {
  if (!books.length) return `📚 ${label}\n\nNo matching books.`;
  return [
    `📚 ${label} (${books.length})`,
    '',
    ...books.map((book) => {
      const flags = [
        book.nextToRead ? 'next' : undefined,
        book.priority ? 'priority' : undefined,
        book.favorite ? 'favorite' : undefined,
        book.read ? 'read' : undefined,
      ].filter(Boolean);
      return `• ${book.title}${book.author ? ` — ${book.author}` : ''}${book.categories.length ? `\n  ${book.categories.join(', ')}` : ''}${flags.length ? ` · ${flags.join(', ')}` : ''}${book.url ? `\n  ${book.url}` : ''}`;
    }),
  ].join('\n');
};

const replySplit = async (
  api: Api,
  chatId: bigint,
  text: string,
): Promise<void> => {
  for (const part of splitTelegramMessage(text)) {
    await api.sendMessage(chatId.toString(), part, {
      link_preview_options: { is_disabled: true },
    });
  }
};

export const createStudyTransport = (bot: Bot): StudyTransport => ({
  stage: async (chatId, text) => {
    await bot.api.sendMessage(Number(chatId), text);
  },
  text: async (chatId, text) => {
    await bot.api.sendMessage(Number(chatId), text, { parse_mode: 'HTML' });
  },
  quiz: async (chatId, text) => {
    await bot.api.sendMessage(Number(chatId), text, { parse_mode: 'HTML' });
  },
  anki: async ({ chatId, document, fileName, cardCount }) => {
    await bot.api.sendDocument(
      Number(chatId),
      new InputFile(document, fileName),
      {
        caption: `🗂 ${cardCount} Anki flashcards ready. In Anki, choose Import and select this TSV file.`,
      },
    );
  },
  lectureReady: async ({ chatId, audio, fileName, durationSeconds, jobId }) => {
    await bot.api.sendVoice(Number(chatId), new InputFile(audio, fileName), {
      duration: Math.round(durationSeconds),
    });
    await bot.api.sendMessage(Number(chatId), '🎧 Your lecture is ready.', {
      reply_markup: actions(jobId),
    });
  },
});

export const createStudyBot = (dependencies: {
  token: string;
  allowedIds: ReadonlySet<number>;
  store: StudyStore;
  storage: StudyStorage;
  documentsBucket: string;
  maxPdfBytes: number;
  service: () => StudyService;
  download: (fileId: string) => Promise<Uint8Array>;
  reportError: (error: unknown) => void;
  books?: StudyBookLibrary;
}): Bot => {
  const bot = new Bot(dependencies.token);
  bot.use(authorizationMiddleware(dependencies.allowedIds));
  bot.command(['start', 'help'], async (ctx) => ctx.reply(studyHelp));
  bot.command('about', async (ctx) => ctx.reply(studyAbout));
  bot.command('status', async (ctx) => {
    const job = await dependencies.store.latestJob(BigInt(ctx.chat.id));
    if (!job) {
      await ctx.reply('No study document has been received yet.');
      return;
    }
    await ctx.reply(
      `📚 ${job.document.originalFilename}\nStatus: ${statusLabel[job.status] ?? job.status}${job.error ? `\nError: ${job.error}` : ''}`,
    );
  });
  bot.command('cancel', async (ctx) => {
    const cancelled = await dependencies.store.cancelLatest(
      BigInt(ctx.chat.id),
    );
    await ctx.reply(
      cancelled
        ? 'Cancelled. The current stage will stop safely.'
        : 'There is no active job to cancel.',
    );
  });
  bot.command('book_add', async (ctx) => {
    if (!dependencies.books) {
      await ctx.reply(
        'The Notion book library is not configured. Configure NOTION_API_KEY and STUDY_NOTION_BOOKS_DATA_SOURCE_ID.',
      );
      return;
    }
    const title = bookTitleInputSchema.safeParse(
      commandArgument(ctx.message?.text),
    );
    if (!title.success) {
      await ctx.reply('Usage: /book_add BOOK TITLE');
      return;
    }
    if (!ctx.from) {
      await ctx.reply('I could not identify the sender.');
      return;
    }
    await ctx.reply('🔎 Looking up book metadata…');
    try {
      const prepared = await dependencies.books.prepare({
        chatId: BigInt(ctx.chat.id),
        userId: BigInt(ctx.from.id),
        title: title.data,
      });
      await ctx.reply(renderBookDraft(prepared.draft), {
        reply_markup: bookConfirmation(prepared.id),
        link_preview_options: { is_disabled: true },
      });
    } catch (error) {
      dependencies.reportError(error);
      await ctx.reply(
        'I could not find reliable book metadata. Try a more exact title.',
      );
    }
  });
  const listBooks = async (
    ctx: Context,
    filter: BookListFilter,
    label: string,
  ): Promise<void> => {
    if (!ctx.chat) return;
    if (!dependencies.books) {
      await ctx.reply('The Notion book library is not configured.');
      return;
    }
    try {
      await replySplit(
        ctx.api,
        BigInt(ctx.chat.id),
        renderBooks(await dependencies.books.list(filter), label),
      );
    } catch (error) {
      dependencies.reportError(error);
      await ctx.reply('I could not read the Notion book library.');
    }
  };
  bot.command('books', async (ctx) =>
    listBooks(ctx, { type: 'all' }, 'All books'),
  );
  bot.command('books_category', async (ctx) => {
    const category = bookCategoryInputSchema.safeParse(
      commandArgument(ctx.message?.text).trim(),
    );
    if (!category.success) {
      await ctx.reply(
        'Usage: /books_category CATEGORY — use /books_categories for valid values.',
      );
      return;
    }
    await listBooks(
      ctx,
      { type: 'category', value: category.data },
      `Category: ${category.data}`,
    );
  });
  bot.command('books_author', async (ctx) => {
    const author = bookAuthorInputSchema.safeParse(
      commandArgument(ctx.message?.text),
    );
    if (!author.success) {
      await ctx.reply('Usage: /books_author AUTHOR');
      return;
    }
    await listBooks(
      ctx,
      { type: 'author', value: author.data },
      `Author: ${author.data}`,
    );
  });
  bot.command('books_next', async (ctx) =>
    listBooks(ctx, { type: 'next' }, 'Next to read'),
  );
  bot.command('books_favorites', async (ctx) =>
    listBooks(ctx, { type: 'favorites' }, 'Favorite books'),
  );
  bot.command('books_categories', async (ctx) => {
    if (!dependencies.books) {
      await ctx.reply('The Notion book library is not configured.');
      return;
    }
    try {
      const categories = await dependencies.books.categories();
      await replySplit(
        ctx.api,
        BigInt(ctx.chat.id),
        `📚 Available categories (${categories.length})\n\n${categories.map((value) => `• ${value}`).join('\n')}`,
      );
    } catch (error) {
      dependencies.reportError(error);
      await ctx.reply('I could not read book categories from Notion.');
    }
  });
  bot.command('books_authors', async (ctx) => {
    if (!dependencies.books) {
      await ctx.reply('The Notion book library is not configured.');
      return;
    }
    try {
      const authors = await dependencies.books.authors();
      await replySplit(
        ctx.api,
        BigInt(ctx.chat.id),
        `📚 Available authors (${authors.length})\n\n${authors.map((value) => `• ${value}`).join('\n')}`,
      );
    } catch (error) {
      dependencies.reportError(error);
      await ctx.reply('I could not read book authors from Notion.');
    }
  });
  bot.on('message:document', async (ctx) => {
    const document = ctx.message.document;
    const mimeType = document.mime_type;
    if (mimeType !== 'application/pdf') {
      await ctx.reply('Please upload a PDF with MIME type application/pdf.');
      return;
    }
    if (!document.file_size || document.file_size > dependencies.maxPdfBytes) {
      await ctx.reply(
        `This PDF is too large. The limit is ${Math.floor(dependencies.maxPdfBytes / 1_000_000)} MB.`,
      );
      return;
    }
    if (!ctx.from) {
      await ctx.reply('I could not identify the sender of this upload.');
      return;
    }
    await ctx.reply('📚 PDF received. Analyzing the material...');
    try {
      const bytes = await dependencies.download(document.file_id);
      if (bytes.byteLength > dependencies.maxPdfBytes)
        throw new Error('Downloaded PDF exceeds the configured size limit.');
      const sourceObjectKey = `study-bot/documents/${randomUUID()}.pdf`;
      await dependencies.storage.put(
        dependencies.documentsBucket,
        sourceObjectKey,
        bytes,
        'application/pdf',
      );
      const created = await dependencies.store.createDocumentAndJob({
        chatId: BigInt(ctx.chat.id),
        userId: BigInt(ctx.from.id),
        originalFilename: document.file_name ?? 'study-material.pdf',
        mimeType,
        byteSize: bytes.byteLength,
        sourceObjectKey,
      });
      const job = created.jobs[0];
      if (!job) throw new Error('Study job could not be created.');
      void dependencies
        .service()
        .process(job.id)
        .catch(dependencies.reportError);
    } catch (error) {
      dependencies.reportError(error);
      await ctx.reply(
        '❌ I could not safely receive this PDF. Please try again.',
      );
    }
  });
  bot.callbackQuery(
    /^study:(full|summary|quiz|anki):([\w-]+)$/u,
    async (ctx) => {
      const action = ctx.match[1];
      const jobId = ctx.match[2];
      if (!ctx.chat || !action || !jobId) return;
      await ctx.answerCallbackQuery({ text: 'Working on it…' });
      const chatId = BigInt(ctx.chat.id);
      const service = dependencies.service();
      const run =
        action === 'full'
          ? service.sendFullLecture(jobId, chatId)
          : action === 'summary'
            ? service.sendQuickSummary(jobId, chatId)
            : action === 'quiz'
              ? service.startQuiz(jobId, chatId)
              : service.sendAnkiDeck(jobId, chatId);
      void run.catch(dependencies.reportError);
    },
  );
  bot.callbackQuery(/^study:book:(confirm|cancel):([\w-]+)$/u, async (ctx) => {
    const action = ctx.match[1];
    const draftId = ctx.match[2];
    if (!ctx.chat || !ctx.from || !action || !draftId) {
      await ctx.answerCallbackQuery({ text: 'Invalid confirmation.' });
      return;
    }
    if (!dependencies.books) {
      await ctx.answerCallbackQuery({ text: 'Book library unavailable.' });
      return;
    }
    const ownership = {
      id: draftId,
      chatId: BigInt(ctx.chat.id),
      userId: BigInt(ctx.from.id),
    };
    if (action === 'cancel') {
      const cancelled = await dependencies.books.cancel(ownership);
      await ctx.answerCallbackQuery({
        text: cancelled ? 'Cancelled.' : 'Already handled or expired.',
      });
      if (cancelled) await ctx.reply('Book was not saved.');
      return;
    }
    await ctx.answerCallbackQuery({ text: 'Saving to Notion…' });
    try {
      const result = await dependencies.books.confirm(ownership);
      await ctx.reply(
        `${result.created ? '✅ Saved' : 'ℹ️ Already exists'}: ${result.title}${result.url ? `\n${result.url}` : ''}`,
        { link_preview_options: { is_disabled: true } },
      );
    } catch (error) {
      dependencies.reportError(error);
      await ctx.reply(
        'The book could not be saved. The confirmation remains retryable until it expires.',
      );
    }
  });
  bot.on('message:text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) return;
    await dependencies
      .service()
      .answerQuiz(BigInt(ctx.chat.id), ctx.message.text);
  });
  bot.catch((error) => dependencies.reportError(error));
  return bot;
};
