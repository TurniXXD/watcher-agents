CREATE TYPE "BriefingDeliveryChannel" AS ENUM ('VOICE', 'INDEX', 'TRANSCRIPT', 'TEXT_FALLBACK');
CREATE TYPE "BriefingDeliveryStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

CREATE TABLE "briefing_delivery_attempts" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "channel" "BriefingDeliveryChannel" NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" "BriefingDeliveryStatus" NOT NULL DEFAULT 'RUNNING',
    "telegramMessageId" TEXT,
    "failureReason" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "briefing_delivery_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "briefing_delivery_attempts_runId_channel_attempt_key"
ON "briefing_delivery_attempts"("runId", "channel", "attempt");

CREATE INDEX "briefing_delivery_attempts_runId_channel_status_idx"
ON "briefing_delivery_attempts"("runId", "channel", "status");

ALTER TABLE "briefing_delivery_attempts"
ADD CONSTRAINT "briefing_delivery_attempts_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "briefing_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
