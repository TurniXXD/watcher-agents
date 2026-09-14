CREATE TYPE "StudyJobStatus" AS ENUM (
  'RECEIVED', 'EXTRACTING', 'ANALYZING', 'OUTLINING', 'GENERATING_LECTURE',
  'GENERATING_AUDIO', 'SENDING', 'COMPLETED', 'FAILED', 'CANCELLED'
);

CREATE TABLE "study_documents" (
  "id" TEXT NOT NULL,
  "chatId" BIGINT NOT NULL,
  "userId" BIGINT NOT NULL,
  "originalFilename" TEXT NOT NULL,
  "title" TEXT,
  "mimeType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "sourceObjectKey" TEXT NOT NULL,
  "pageCount" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "study_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "study_document_pages" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "pageNumber" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "study_document_pages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "study_processing_jobs" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "chatId" BIGINT NOT NULL,
  "status" "StudyJobStatus" NOT NULL DEFAULT 'RECEIVED',
  "error" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "study_processing_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "study_generated_lectures" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "script" TEXT NOT NULL,
  "outline" JSONB NOT NULL,
  "audioObjectKey" TEXT,
  "audioMimeType" TEXT,
  "durationSeconds" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "study_generated_lectures_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "study_quiz_sessions" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "questions" JSONB NOT NULL,
  "current" INTEGER NOT NULL DEFAULT 0,
  "score" INTEGER NOT NULL DEFAULT 0,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "study_quiz_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "study_documents_sourceObjectKey_key" ON "study_documents"("sourceObjectKey");
CREATE INDEX "study_documents_chatId_createdAt_idx" ON "study_documents"("chatId", "createdAt");
CREATE UNIQUE INDEX "study_document_pages_documentId_pageNumber_key" ON "study_document_pages"("documentId", "pageNumber");
CREATE INDEX "study_document_pages_documentId_pageNumber_idx" ON "study_document_pages"("documentId", "pageNumber");
CREATE INDEX "study_processing_jobs_chatId_createdAt_idx" ON "study_processing_jobs"("chatId", "createdAt");
CREATE INDEX "study_processing_jobs_status_createdAt_idx" ON "study_processing_jobs"("status", "createdAt");
CREATE UNIQUE INDEX "study_generated_lectures_jobId_key" ON "study_generated_lectures"("jobId");
CREATE UNIQUE INDEX "study_quiz_sessions_jobId_key" ON "study_quiz_sessions"("jobId");

ALTER TABLE "study_document_pages" ADD CONSTRAINT "study_document_pages_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "study_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "study_processing_jobs" ADD CONSTRAINT "study_processing_jobs_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "study_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "study_generated_lectures" ADD CONSTRAINT "study_generated_lectures_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "study_processing_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "study_quiz_sessions" ADD CONSTRAINT "study_quiz_sessions_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "study_processing_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
