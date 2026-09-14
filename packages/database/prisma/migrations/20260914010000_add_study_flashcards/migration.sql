CREATE TABLE "study_flashcard_decks" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "cards" JSONB NOT NULL,
  "ankiObjectKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "study_flashcard_decks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "study_flashcard_decks_jobId_key" ON "study_flashcard_decks"("jobId");
CREATE UNIQUE INDEX "study_flashcard_decks_ankiObjectKey_key" ON "study_flashcard_decks"("ankiObjectKey");

ALTER TABLE "study_flashcard_decks" ADD CONSTRAINT "study_flashcard_decks_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "study_processing_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
