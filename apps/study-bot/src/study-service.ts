import {
  HEAVY_LOCAL_MODEL_RESOURCE,
  ResourceLeaseStore,
  StudyStore,
  type StudyJobStatus,
} from '@watcher/database';
import type { WatcherLogger } from '@watcher/core';
import type { StudyLlm } from './llm/study-llm.js';
import {
  chunkAnalysisPrompt,
  flashcardPrompt,
  lecturePrompt,
  outlinePrompt,
  quickSummaryPrompt,
  quizPrompt,
} from './llm/prompts.js';
import { chunkPages } from './ingestion/chunker.js';
import { renderAnkiTsv } from './anki.js';
import {
  hasMeaningfulText,
  type PdfExtractor,
} from './ingestion/pdf-extractor.js';
import type { StudyStorage } from './storage/s3-storage.js';
import {
  chunkFactSchema,
  flashcardDeckSchema,
  outlineSchema,
  quizSchema,
  type ChunkFact,
  type StudyOutline,
} from './types.js';
import type { TTSProvider } from './tts/piper-tts.js';
import { z } from 'zod';

const lectureSchema = z.object({ script: z.string().min(200) });
const summarySchema = z.object({ summary: z.string().min(1) });
const factsSchema = z.array(chunkFactSchema);
const cachedLectureSchema = z.object({
  outline: outlineSchema,
  facts: factsSchema,
});

export type StudyTransport = {
  stage(chatId: bigint, text: string): Promise<void>;
  lectureReady(input: {
    chatId: bigint;
    audio: Uint8Array;
    fileName: string;
    durationSeconds: number;
    jobId: string;
  }): Promise<void>;
  text(chatId: bigint, text: string): Promise<void>;
  quiz(chatId: bigint, text: string): Promise<void>;
  anki(input: {
    chatId: bigint;
    document: Uint8Array;
    fileName: string;
    cardCount: number;
  }): Promise<void>;
};

export class StudyService {
  public constructor(
    private readonly dependencies: {
      store: StudyStore;
      storage: StudyStorage;
      extractor: PdfExtractor;
      llm: StudyLlm;
      tts: TTSProvider;
      lease: ResourceLeaseStore;
      transport: StudyTransport;
      documentsBucket: string;
      mediaBucket: string;
      maxPages: number;
      logger: WatcherLogger;
    },
  ) {}

  public async process(jobId: string): Promise<void> {
    const initial = await this.dependencies.store.getJob(jobId);
    if (!initial || initial.status === 'CANCELLED') return;
    const { store, transport } = this.dependencies;
    try {
      await this.stage(jobId, 'EXTRACTING', '📖 Extracting text...');
      const pdf = await this.dependencies.storage.get(
        this.dependencies.documentsBucket,
        initial.document.sourceObjectKey,
      );
      const pages = await this.dependencies.extractor.extract(pdf);
      if (pages.length > this.dependencies.maxPages) {
        throw new Error(
          `This PDF has ${pages.length} pages; the current limit is ${this.dependencies.maxPages}.`,
        );
      }
      if (!hasMeaningfulText(pages)) {
        throw new Error(
          'This PDF does not contain enough selectable text. OCR is required before I can create a source-grounded lecture.',
        );
      }
      await store.savePages(initial.documentId, pages);
      const chunks = chunkPages(initial.documentId, pages);
      if (!chunks.length)
        throw new Error('No readable text chunks were found. OCR is required.');

      await this.stage(jobId, 'ANALYZING', '🧠 Creating study outline...');
      const facts: ChunkFact[] = [];
      for (const chunk of chunks) {
        await this.assertActive(jobId);
        facts.push(
          await this.dependencies.llm.generate(
            chunkAnalysisPrompt(chunk),
            chunkFactSchema,
          ),
        );
      }
      await this.stage(jobId, 'OUTLINING');
      const outline = await this.dependencies.llm.generate(
        outlinePrompt(facts),
        outlineSchema,
      );
      await this.stage(jobId, 'GENERATING_LECTURE', '✍️ Preparing lecture...');
      const lecture = await this.dependencies.llm.generate(
        lecturePrompt(outline, facts),
        lectureSchema,
      );
      await store.saveLecture({
        jobId,
        script: lecture.script,
        outline: { outline, facts },
      });

      await this.stage(jobId, 'GENERATING_AUDIO', '🎙️ Generating audio...');
      const audio = await this.dependencies.lease.withExclusiveLease(
        HEAVY_LOCAL_MODEL_RESOURCE,
        () => this.dependencies.tts.synthesize(lecture.script),
      );
      await this.assertActive(jobId);
      const audioObjectKey = `study-bot/lectures/${jobId}.ogg`;
      await this.dependencies.storage.put(
        this.dependencies.mediaBucket,
        audioObjectKey,
        audio.audio,
        audio.mimeType,
      );
      await store.saveLecture({
        jobId,
        script: lecture.script,
        outline: { outline, facts },
        audioObjectKey,
        audioMimeType: audio.mimeType,
        durationSeconds: audio.durationSeconds,
      });
      await this.stage(jobId, 'SENDING');
      await transport.lectureReady({
        chatId: initial.chatId,
        audio: audio.audio,
        fileName: audio.fileName,
        durationSeconds: audio.durationSeconds,
        jobId,
      });
      await store.transition(jobId, 'COMPLETED');
      this.dependencies.logger.info(
        {
          event: 'study_job_completed',
          jobId,
          pageCount: pages.length,
          chunkCount: chunks.length,
          audioDurationSeconds: audio.durationSeconds,
        },
        'Study job completed',
      );
    } catch (error) {
      const latest = await store.getJob(jobId);
      if (latest?.status === 'CANCELLED') return;
      const message =
        error instanceof Error ? error.message : 'Unexpected processing error';
      try {
        await store.transition(jobId, 'FAILED', message);
      } catch {
        // A concurrent cancellation won the state transition.
      }
      this.dependencies.logger.error(
        { event: 'study_job_failed', jobId, error: message },
        'Study job failed',
      );
      await transport.text(
        initial.chatId,
        `❌ I could not create the lecture. ${message}`,
      );
    }
  }

  public async sendFullLecture(jobId: string, chatId: bigint): Promise<void> {
    const job = await this.dependencies.store.getJob(jobId);
    if (!job?.lecture?.audioObjectKey || job.chatId !== chatId) return;
    const audio = await this.dependencies.storage.get(
      this.dependencies.mediaBucket,
      job.lecture.audioObjectKey,
    );
    await this.dependencies.transport.lectureReady({
      chatId,
      audio,
      fileName: 'study-lecture.ogg',
      durationSeconds: job.lecture.durationSeconds ?? 0,
      jobId,
    });
  }

  public async sendQuickSummary(jobId: string, chatId: bigint): Promise<void> {
    const facts = await this.facts(jobId, chatId);
    if (!facts) return;
    const summary = await this.dependencies.llm.generate(
      quickSummaryPrompt(facts),
      summarySchema,
    );
    await this.dependencies.transport.text(
      chatId,
      `📄 <b>Text summary</b>\n\n${summary.summary}`,
    );
  }

  public async startQuiz(jobId: string, chatId: bigint): Promise<void> {
    const facts = await this.facts(jobId, chatId);
    if (!facts) return;
    const quiz = await this.dependencies.llm.generate(
      quizPrompt(facts),
      quizSchema,
    );
    await this.dependencies.store.saveQuiz(jobId, quiz);
    const question = quiz.questions[0]!;
    await this.dependencies.transport.quiz(chatId, this.quizText(question, 1));
  }

  public async sendAnkiDeck(jobId: string, chatId: bigint): Promise<void> {
    const job = await this.dependencies.store.getJob(jobId);
    if (!job || job.chatId !== chatId) return;
    if (job.flashcards) {
      const document = await this.dependencies.storage.get(
        this.dependencies.mediaBucket,
        job.flashcards.ankiObjectKey,
      );
      await this.dependencies.transport.anki({
        chatId,
        document,
        fileName: 'study-flashcards.tsv',
        cardCount: flashcardDeckSchema.parse(job.flashcards.cards).cards.length,
      });
      return;
    }
    const facts = await this.facts(jobId, chatId);
    if (!facts) return;
    const deck = await this.dependencies.llm.generate(
      flashcardPrompt(facts),
      flashcardDeckSchema,
    );
    const document = new TextEncoder().encode(renderAnkiTsv(deck));
    const ankiObjectKey = `study-bot/anki/${jobId}.tsv`;
    await this.dependencies.storage.put(
      this.dependencies.mediaBucket,
      ankiObjectKey,
      document,
      'text/tab-separated-values; charset=utf-8',
    );
    await this.dependencies.store.saveFlashcardDeck({
      jobId,
      title: deck.title,
      cards: deck,
      ankiObjectKey,
    });
    await this.dependencies.transport.anki({
      chatId,
      document,
      fileName: 'study-flashcards.tsv',
      cardCount: deck.cards.length,
    });
  }

  public async answerQuiz(chatId: bigint, answer: string): Promise<boolean> {
    const job = await this.dependencies.store.latestJob(chatId);
    if (!job?.quiz || job.quiz.completedAt) return false;
    const quiz = quizSchema.safeParse(job.quiz.questions);
    if (!quiz.success) return false;
    const question = quiz.data.questions[job.quiz.current];
    if (!question) return false;
    const correct =
      answer.trim().toLocaleLowerCase() ===
      question.answer.trim().toLocaleLowerCase();
    const score = job.quiz.score + Number(correct);
    const next = job.quiz.current + 1;
    await this.dependencies.transport.quiz(
      chatId,
      `${correct ? '✅ Correct.' : '❌ Not quite.'}\n\n${question.explanation}\n📄 Source: pp. ${question.sourcePages.start}-${question.sourcePages.end}`,
    );
    if (next >= quiz.data.questions.length) {
      await this.dependencies.store.updateQuiz(job.id, {
        current: next,
        score,
        completedAt: new Date(),
      });
      await this.dependencies.transport.quiz(
        chatId,
        `🧠 Quiz complete: ${score}/${quiz.data.questions.length}.`,
      );
    } else {
      await this.dependencies.store.updateQuiz(job.id, {
        current: next,
        score,
      });
      await this.dependencies.transport.quiz(
        chatId,
        this.quizText(quiz.data.questions[next]!, next + 1),
      );
    }
    return true;
  }

  private async facts(
    jobId: string,
    chatId: bigint,
  ): Promise<ChunkFact[] | undefined> {
    const job = await this.dependencies.store.getJob(jobId);
    if (!job?.lecture || job.chatId !== chatId) return undefined;
    const cached = cachedLectureSchema.safeParse(job.lecture.outline);
    return cached.success ? cached.data.facts : undefined;
  }

  private async stage(
    jobId: string,
    status: StudyJobStatus,
    message?: string,
  ): Promise<void> {
    const job = await this.dependencies.store.getJob(jobId);
    if (!job || job.status === 'CANCELLED')
      throw new Error('This job was cancelled.');
    await this.dependencies.store.transition(jobId, status);
    if (message) await this.dependencies.transport.stage(job.chatId, message);
  }

  private async assertActive(jobId: string): Promise<void> {
    const job = await this.dependencies.store.getJob(jobId);
    if (!job || job.status === 'CANCELLED')
      throw new Error('This job was cancelled.');
  }

  private quizText(
    question: z.infer<typeof quizSchema>['questions'][number],
    number: number,
  ): string {
    const options =
      question.kind === 'MULTIPLE_CHOICE'
        ? `\n${question.options.map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`).join('\n')}`
        : question.kind === 'TRUE_FALSE'
          ? '\nReply true or false.'
          : '';
    return `🧠 <b>Question ${number}/5</b>\n\n${question.question}${options}\n\nReply with your answer.`;
  }
}
