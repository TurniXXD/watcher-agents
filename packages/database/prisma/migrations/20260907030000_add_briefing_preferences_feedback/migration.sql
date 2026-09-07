CREATE TYPE "BriefingFeedbackRating" AS ENUM ('USEFUL', 'NOT_USEFUL', 'TOO_LONG');

ALTER TABLE "briefing_settings"
ADD COLUMN "priorityKeywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "mutedKeywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "briefing_feedback" (
  "id" TEXT NOT NULL,
  "settingsId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "rating" "BriefingFeedbackRating" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "briefing_feedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "briefing_feedback_runId_key" ON "briefing_feedback"("runId");
CREATE INDEX "briefing_feedback_settingsId_createdAt_idx" ON "briefing_feedback"("settingsId", "createdAt");

ALTER TABLE "briefing_feedback"
ADD CONSTRAINT "briefing_feedback_settingsId_fkey"
FOREIGN KEY ("settingsId") REFERENCES "briefing_settings"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "briefing_feedback"
ADD CONSTRAINT "briefing_feedback_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "briefing_runs"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
