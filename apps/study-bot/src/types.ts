import { z } from 'zod';

export const pageSchema = z.object({
  pageNumber: z.number().int().positive(),
  text: z.string(),
});

export type StudyPage = z.infer<typeof pageSchema>;

export const sourceRangeSchema = z
  .object({
    start: z.number().int().positive(),
    end: z.number().int().positive(),
  })
  .refine(({ start, end }) => end >= start, 'Source range is reversed');

export const chunkFactSchema = z.object({
  topic: z.string().min(1),
  summary: z.string().min(1),
  keyFacts: z.array(z.string()),
  definitions: z.array(z.string()),
  sourcePages: sourceRangeSchema,
});

export type ChunkFact = z.infer<typeof chunkFactSchema>;

export const outlineSchema = z.object({
  title: z.string().min(1),
  sections: z.array(
    z.object({
      title: z.string().min(1),
      learningGoals: z.array(z.string()),
      sourcePages: sourceRangeSchema,
    }),
  ),
});

export type StudyOutline = z.infer<typeof outlineSchema>;

export const quizQuestionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('MULTIPLE_CHOICE'),
    question: z.string().min(1),
    options: z.array(z.string().min(1)).min(2).max(4),
    answer: z.string().min(1),
    explanation: z.string().min(1),
    sourcePages: sourceRangeSchema,
  }),
  z.object({
    kind: z.literal('TRUE_FALSE'),
    question: z.string().min(1),
    answer: z.enum(['true', 'false']),
    explanation: z.string().min(1),
    sourcePages: sourceRangeSchema,
  }),
  z.object({
    kind: z.literal('SHORT_ANSWER'),
    question: z.string().min(1),
    answer: z.string().min(1),
    explanation: z.string().min(1),
    sourcePages: sourceRangeSchema,
  }),
]);

export const quizSchema = z.object({
  questions: z.array(quizQuestionSchema).length(5),
});
export type StudyQuiz = z.infer<typeof quizSchema>;

export const flashcardSchema = z.object({
  front: z.string().min(1),
  back: z.string().min(1),
  sourcePages: sourceRangeSchema,
  tags: z.array(z.string().min(1)).max(5),
});

export const flashcardDeckSchema = z.object({
  title: z.string().min(1),
  cards: z.array(flashcardSchema).min(5).max(30),
});

export type FlashcardDeck = z.infer<typeof flashcardDeckSchema>;

export type StudyChunk = {
  documentId: string;
  pageRange: z.infer<typeof sourceRangeSchema>;
  section?: string;
  sourceText: string;
};
