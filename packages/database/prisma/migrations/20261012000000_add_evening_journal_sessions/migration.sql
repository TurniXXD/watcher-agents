CREATE TYPE "JournalMode" AS ENUM ('TEXT', 'VOICE');
CREATE TYPE "JournalStatus" AS ENUM ('REMINDER_PENDING', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'COMPLETED', 'SKIPPED', 'CANCELLED');
CREATE TYPE "JournalSyncStatus" AS ENUM ('NOT_READY', 'PENDING', 'SYNCED', 'FAILED', 'CONFLICT');

CREATE TABLE "journal_sessions" (
    "id" TEXT NOT NULL,
    "settingsId" TEXT NOT NULL,
    "telegramUserId" BIGINT NOT NULL,
    "journalDate" VARCHAR(10) NOT NULL,
    "mode" "JournalMode",
    "status" "JournalStatus" NOT NULL DEFAULT 'REMINDER_PENDING',
    "currentQuestion" INTEGER NOT NULL DEFAULT 0,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "transcript" TEXT,
    "draft" JSONB,
    "reminderAt" TIMESTAMP(3) NOT NULL,
    "reminderSentAt" TIMESTAMP(3),
    "reminderLeaseUntil" TIMESTAMP(3),
    "confirmationRequired" BOOLEAN NOT NULL DEFAULT true,
    "syncStatus" "JournalSyncStatus" NOT NULL DEFAULT 'NOT_READY',
    "syncAttempts" INTEGER NOT NULL DEFAULT 0,
    "syncNextAttemptAt" TIMESTAMP(3),
    "syncError" TEXT,
    "notionPageId" TEXT,
    "notionPageUrl" TEXT,
    "syncedAnswers" JSONB,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "journal_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "journal_sessions_settingsId_telegramUserId_journalDate_key" ON "journal_sessions"("settingsId", "telegramUserId", "journalDate");
CREATE INDEX "journal_sessions_status_reminderAt_idx" ON "journal_sessions"("status", "reminderAt");
CREATE INDEX "journal_sessions_syncStatus_syncNextAttemptAt_idx" ON "journal_sessions"("syncStatus", "syncNextAttemptAt");
ALTER TABLE "journal_sessions" ADD CONSTRAINT "journal_sessions_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "briefing_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
