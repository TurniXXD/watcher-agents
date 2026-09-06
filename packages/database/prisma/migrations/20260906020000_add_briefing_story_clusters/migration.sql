CREATE TABLE "briefing_story_clusters" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" "BriefingEventStatus" NOT NULL,
    "importance" INTEGER NOT NULL,
    "novelty" INTEGER NOT NULL,
    "relevance" INTEGER NOT NULL,
    "urgency" INTEGER NOT NULL,
    "actionable" BOOLEAN NOT NULL,
    "actionItems" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "watcherBots" "BriefingWatcherBot"[] NOT NULL,
    "entities" JSONB NOT NULL,
    "sourceUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "firstEventAt" TIMESTAMP(3) NOT NULL,
    "lastEventAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "briefing_story_clusters_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "briefing_story_clusters_scores_check" CHECK (
      "importance" BETWEEN 0 AND 100 AND
      "novelty" BETWEEN 0 AND 100 AND
      "relevance" BETWEEN 0 AND 100 AND
      "urgency" BETWEEN 0 AND 100
    ),
    CONSTRAINT "briefing_story_clusters_time_check" CHECK ("lastEventAt" >= "firstEventAt")
);

CREATE TABLE "briefing_story_cluster_events" (
    "clusterId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "briefing_story_cluster_events_pkey" PRIMARY KEY ("clusterId", "eventId")
);

CREATE INDEX "briefing_story_clusters_status_lastEventAt_idx"
ON "briefing_story_clusters"("status", "lastEventAt");

CREATE UNIQUE INDEX "briefing_story_cluster_events_eventId_key"
ON "briefing_story_cluster_events"("eventId");

ALTER TABLE "briefing_story_cluster_events"
ADD CONSTRAINT "briefing_story_cluster_events_clusterId_fkey"
FOREIGN KEY ("clusterId") REFERENCES "briefing_story_clusters"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "briefing_story_cluster_events"
ADD CONSTRAINT "briefing_story_cluster_events_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "briefing_events"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
