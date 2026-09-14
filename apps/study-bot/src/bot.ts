import { commandArgument, authorizationMiddleware } from '@watcher/telegram';
import { InputFile, InlineKeyboard, Bot } from 'grammy';
import { randomUUID } from 'node:crypto';
import type { StudyStore } from '@watcher/database';
import type { StudyStorage } from './storage/s3-storage.js';
import type { StudyService, StudyTransport } from './study-service.js';

const help = `📚 Study bot

Send a text-based PDF and I will create a source-grounded spoken lecture. Scanned PDFs need OCR first.

/status — latest document job
/cancel — cancel latest running job
/help — this help`;

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
}): Bot => {
  const bot = new Bot(dependencies.token);
  bot.use(authorizationMiddleware(dependencies.allowedIds));
  bot.command(['start', 'help'], async (ctx) => ctx.reply(help));
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
  bot.on('message:text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) return;
    await dependencies
      .service()
      .answerQuiz(BigInt(ctx.chat.id), ctx.message.text);
  });
  bot.catch((error) => dependencies.reportError(error));
  return bot;
};
