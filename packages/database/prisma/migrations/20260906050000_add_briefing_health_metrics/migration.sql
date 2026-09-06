CREATE TYPE "BriefingWatcherHealthStatus" AS ENUM ('HEALTHY', 'DEGRADED', 'UNAVAILABLE');

ALTER TABLE "briefing_runs"
ADD COLUMN "briefingDataCoverage" INTEGER,
ADD COLUMN "metrics" JSONB;

CREATE TABLE "briefing_watcher_health" (
    "watcherBot" "BriefingWatcherBot" NOT NULL,
    "status" "BriefingWatcherHealthStatus" NOT NULL,
    "lastRunAt" TIMESTAMP(3) NOT NULL,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastError" TEXT,
    "eventsEmitted" INTEGER NOT NULL DEFAULT 0,
    "failedEventPublications" INTEGER NOT NULL DEFAULT 0,
    "sourceFailures" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "briefing_watcher_health_pkey" PRIMARY KEY ("watcherBot")
);

CREATE INDEX "briefing_watcher_health_status_lastRunAt_idx"
ON "briefing_watcher_health"("status", "lastRunAt");
