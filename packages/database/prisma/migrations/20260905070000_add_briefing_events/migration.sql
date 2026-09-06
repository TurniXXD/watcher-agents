CREATE TYPE "BriefingWatcherBot" AS ENUM ('STOCKS', 'MEDICAL');
CREATE TYPE "BriefingConfidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "BriefingEventStatus" AS ENUM ('NEW', 'DEVELOPING', 'UNCHANGED', 'RESOLVED');

CREATE TABLE "briefing_events" (
    "id" TEXT NOT NULL,
    "watcherBot" "BriefingWatcherBot" NOT NULL,
    "externalEventId" TEXT,
    "occurredAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "importance" INTEGER NOT NULL,
    "novelty" INTEGER NOT NULL,
    "relevance" INTEGER NOT NULL,
    "urgency" INTEGER NOT NULL,
    "actionable" BOOLEAN NOT NULL,
    "action" TEXT,
    "entities" JSONB NOT NULL,
    "tags" TEXT[] NOT NULL,
    "sourceUrls" TEXT[] NOT NULL,
    "primarySource" TEXT,
    "confidence" "BriefingConfidence" NOT NULL,
    "status" "BriefingEventStatus" NOT NULL,
    "deduplicationKey" TEXT,
    "relatedEventIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB,

    CONSTRAINT "briefing_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "briefing_events_scores_check" CHECK (
      "importance" BETWEEN 0 AND 100 AND
      "novelty" BETWEEN 0 AND 100 AND
      "relevance" BETWEEN 0 AND 100 AND
      "urgency" BETWEEN 0 AND 100
    )
);

CREATE UNIQUE INDEX "briefing_events_watcherBot_externalEventId_key"
ON "briefing_events"("watcherBot", "externalEventId");

CREATE UNIQUE INDEX "briefing_events_watcherBot_deduplicationKey_key"
ON "briefing_events"("watcherBot", "deduplicationKey");

CREATE INDEX "briefing_events_watcherBot_detectedAt_idx"
ON "briefing_events"("watcherBot", "detectedAt");

CREATE INDEX "briefing_events_status_detectedAt_idx"
ON "briefing_events"("status", "detectedAt");
