CREATE TYPE "StudyBookDraftStatus" AS ENUM (
  'PENDING',
  'SAVING',
  'SAVED',
  'CANCELLED'
);

CREATE TABLE "study_book_drafts" (
  "id" TEXT NOT NULL,
  "chatId" BIGINT NOT NULL,
  "userId" BIGINT NOT NULL,
  "title" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "StudyBookDraftStatus" NOT NULL DEFAULT 'PENDING',
  "notionPageId" TEXT,
  "notionPageUrl" TEXT,
  "lastError" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "study_book_drafts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "study_book_drafts_chatId_userId_status_createdAt_idx"
ON "study_book_drafts"("chatId", "userId", "status", "createdAt");

CREATE INDEX "study_book_drafts_status_expiresAt_idx"
ON "study_book_drafts"("status", "expiresAt");
