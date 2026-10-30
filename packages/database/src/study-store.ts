import type { Prisma } from './generated/prisma/client.js';
import type { DatabaseClient } from './client.js';

export const studyJobStatuses = [
  'RECEIVED',
  'EXTRACTING',
  'ANALYZING',
  'OUTLINING',
  'GENERATING_LECTURE',
  'GENERATING_AUDIO',
  'SENDING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export type StudyJobStatus = (typeof studyJobStatuses)[number];

const transitions: Readonly<Record<StudyJobStatus, readonly StudyJobStatus[]>> =
  {
    RECEIVED: ['EXTRACTING', 'FAILED', 'CANCELLED'],
    EXTRACTING: ['ANALYZING', 'FAILED', 'CANCELLED'],
    ANALYZING: ['OUTLINING', 'FAILED', 'CANCELLED'],
    OUTLINING: ['GENERATING_LECTURE', 'FAILED', 'CANCELLED'],
    GENERATING_LECTURE: ['GENERATING_AUDIO', 'FAILED', 'CANCELLED'],
    GENERATING_AUDIO: ['SENDING', 'FAILED', 'CANCELLED'],
    SENDING: ['COMPLETED', 'FAILED', 'CANCELLED'],
    COMPLETED: [],
    FAILED: [],
    CANCELLED: [],
  };

export type CreateStudyJobInput = {
  chatId: bigint;
  userId: bigint;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  sourceObjectKey: string;
};

export type CreateStudyBookDraftInput = {
  chatId: bigint;
  userId: bigint;
  title: string;
  payload: Prisma.InputJsonValue;
  expiresAt: Date;
};

export class StudyStore {
  public constructor(private readonly db: DatabaseClient) {}

  public createDocumentAndJob(input: CreateStudyJobInput) {
    return this.db.studyDocument.create({
      data: {
        ...input,
        jobs: { create: { chatId: input.chatId } },
      },
      include: { jobs: true },
    });
  }

  public getJob(jobId: string) {
    return this.db.studyProcessingJob.findUnique({
      where: { id: jobId },
      include: { document: true, lecture: true, quiz: true, flashcards: true },
    });
  }

  public latestJob(chatId: bigint) {
    return this.db.studyProcessingJob.findFirst({
      where: { chatId },
      include: { document: true, lecture: true, quiz: true, flashcards: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  public async recoverInterruptedJobs(): Promise<string[]> {
    const interrupted = await this.db.studyProcessingJob.findMany({
      where: {
        status: {
          in: [
            'RECEIVED',
            'EXTRACTING',
            'ANALYZING',
            'OUTLINING',
            'GENERATING_LECTURE',
            'GENERATING_AUDIO',
            'SENDING',
          ],
        },
      },
      select: { id: true },
    });
    if (!interrupted.length) return [];
    await this.db.studyProcessingJob.updateMany({
      where: { id: { in: interrupted.map(({ id }) => id) } },
      data: { status: 'RECEIVED', error: 'Resumed after service restart.' },
    });
    return interrupted.map(({ id }) => id);
  }

  public async transition(jobId: string, next: StudyJobStatus, error?: string) {
    return this.db.$transaction(async (transaction) => {
      const current = await transaction.studyProcessingJob.findUniqueOrThrow({
        where: { id: jobId },
        select: { status: true },
      });
      const previous = current.status;
      if (previous === next)
        return transaction.studyProcessingJob.findUniqueOrThrow({
          where: { id: jobId },
        });
      if (!transitions[previous].includes(next)) {
        throw new Error(`Invalid study job transition ${previous} -> ${next}`);
      }
      const now = new Date();
      return transaction.studyProcessingJob.update({
        where: { id: jobId },
        data: {
          status: next,
          ...(next === 'EXTRACTING' ? { startedAt: now } : {}),
          ...(next === 'CANCELLED'
            ? { cancelledAt: now, finishedAt: now }
            : {}),
          ...(next === 'COMPLETED' || next === 'FAILED'
            ? { finishedAt: now }
            : {}),
          ...(error ? { error: error.slice(0, 2_000) } : {}),
        },
      });
    });
  }

  public async cancelLatest(chatId: bigint): Promise<boolean> {
    const job = await this.latestJob(chatId);
    if (!job || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) {
      return false;
    }
    await this.transition(job.id, 'CANCELLED');
    return true;
  }

  public async savePages(
    documentId: string,
    pages: readonly { pageNumber: number; text: string }[],
  ): Promise<void> {
    await this.db.$transaction([
      this.db.studyDocumentPage.deleteMany({ where: { documentId } }),
      this.db.studyDocument.update({
        where: { id: documentId },
        data: {
          pageCount: pages.length,
          pages: { createMany: { data: [...pages] } },
        },
      }),
    ]);
  }

  public pages(documentId: string) {
    return this.db.studyDocumentPage.findMany({
      where: { documentId },
      orderBy: { pageNumber: 'asc' },
    });
  }

  public saveLecture(input: {
    jobId: string;
    script: string;
    outline: Prisma.InputJsonValue;
    audioObjectKey?: string;
    audioMimeType?: string;
    durationSeconds?: number;
  }) {
    return this.db.studyGeneratedLecture.upsert({
      where: { jobId: input.jobId },
      create: input,
      update: input,
    });
  }

  public saveQuiz(jobId: string, questions: Prisma.InputJsonValue) {
    return this.db.studyQuizSession.upsert({
      where: { jobId },
      create: { jobId, questions },
      update: { questions, current: 0, score: 0, completedAt: null },
    });
  }

  public saveFlashcardDeck(input: {
    jobId: string;
    title: string;
    cards: Prisma.InputJsonValue;
    ankiObjectKey: string;
  }) {
    return this.db.studyFlashcardDeck.upsert({
      where: { jobId: input.jobId },
      create: input,
      update: input,
    });
  }

  public quiz(jobId: string) {
    return this.db.studyQuizSession.findUnique({ where: { jobId } });
  }

  public updateQuiz(
    jobId: string,
    input: { current: number; score: number; completedAt?: Date },
  ) {
    return this.db.studyQuizSession.update({
      where: { jobId },
      data: input,
    });
  }

  public async createBookDraft(input: CreateStudyBookDraftInput) {
    return this.db.$transaction(async (transaction) => {
      await transaction.studyBookDraft.updateMany({
        where: {
          chatId: input.chatId,
          userId: input.userId,
          status: { in: ['PENDING', 'SAVING'] },
        },
        data: { status: 'CANCELLED' },
      });
      return transaction.studyBookDraft.create({ data: input });
    });
  }

  public getPendingBookDraft(input: {
    id: string;
    chatId: bigint;
    userId: bigint;
    now?: Date;
  }) {
    return this.db.studyBookDraft.findFirst({
      where: {
        id: input.id,
        chatId: input.chatId,
        userId: input.userId,
        status: 'PENDING',
        expiresAt: { gt: input.now ?? new Date() },
      },
    });
  }

  public async claimBookDraft(input: {
    id: string;
    chatId: bigint;
    userId: bigint;
    now?: Date;
  }): Promise<boolean> {
    const updated = await this.db.studyBookDraft.updateMany({
      where: {
        id: input.id,
        chatId: input.chatId,
        userId: input.userId,
        status: 'PENDING',
        expiresAt: { gt: input.now ?? new Date() },
      },
      data: { status: 'SAVING', lastError: null },
    });
    return updated.count === 1;
  }

  public completeBookDraft(
    id: string,
    input: { notionPageId: string; notionPageUrl?: string },
  ) {
    return this.db.studyBookDraft.update({
      where: { id },
      data: {
        status: 'SAVED',
        notionPageId: input.notionPageId,
        notionPageUrl: input.notionPageUrl ?? null,
        lastError: null,
      },
    });
  }

  public releaseBookDraft(id: string, error: unknown) {
    return this.db.studyBookDraft.update({
      where: { id },
      data: {
        status: 'PENDING',
        lastError: (error instanceof Error
          ? error.message
          : String(error)
        ).slice(0, 2_000),
      },
    });
  }

  public async cancelBookDraft(input: {
    id: string;
    chatId: bigint;
    userId: bigint;
  }): Promise<boolean> {
    const updated = await this.db.studyBookDraft.updateMany({
      where: { ...input, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    return updated.count === 1;
  }
}
