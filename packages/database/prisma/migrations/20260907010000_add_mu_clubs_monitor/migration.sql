ALTER TYPE "BriefingWatcherBot" ADD VALUE 'MU_CLUBS';

CREATE TYPE "MuClubSourceType" AS ENUM ('WEBSITE', 'INSTAGRAM', 'FACEBOOK', 'RSS', 'CALENDAR', 'LINKTREE', 'OTHER');
CREATE TYPE "MuClubSourceStatus" AS ENUM ('ACTIVE', 'UNSUPPORTED', 'BROKEN', 'MANUAL', 'NO_MONITORABLE_SOURCE');
CREATE TYPE "MuClubActivityType" AS ENUM ('NEW_EVENT', 'REGISTRATION_OPEN', 'RECRUITMENT', 'MEETING', 'WORKSHOP', 'LECTURE', 'DEADLINE', 'TRIP', 'VOLUNTEER_OPPORTUNITY', 'ANNOUNCEMENT', 'OTHER_RELEVANT_UPDATE');
CREATE TYPE "MuMonitorRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED');

CREATE TABLE "mu_clubs" (
  "id" TEXT NOT NULL, "slug" TEXT NOT NULL, "name" TEXT NOT NULL,
  "status" "MuClubSourceStatus" NOT NULL DEFAULT 'ACTIVE', "discoveryUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mu_clubs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mu_clubs_slug_key" ON "mu_clubs"("slug");

CREATE TABLE "mu_club_sources" (
  "id" TEXT NOT NULL, "clubId" TEXT NOT NULL, "type" "MuClubSourceType" NOT NULL,
  "url" TEXT, "externalId" TEXT, "username" TEXT,
  "status" "MuClubSourceStatus" NOT NULL DEFAULT 'ACTIVE', "lastCheckedAt" TIMESTAMP(3),
  "lastSuccessfulAt" TIMESTAMP(3), "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mu_club_sources_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "mu_club_sources_clubId_status_idx" ON "mu_club_sources"("clubId", "status");

CREATE TABLE "instagram_accounts" (
  "username" TEXT NOT NULL, "displayName" TEXT, "biography" TEXT, "profileUrl" TEXT NOT NULL,
  "externalLinks" JSONB NOT NULL, "fetchedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "instagram_accounts_pkey" PRIMARY KEY ("username")
);
CREATE TABLE "instagram_posts" (
  "id" TEXT NOT NULL, "username" TEXT NOT NULL, "shortcode" TEXT, "caption" TEXT,
  "publishedAt" TIMESTAMP(3), "url" TEXT NOT NULL, "mediaType" TEXT, "imageUrl" TEXT,
  "contentHash" TEXT NOT NULL, "raw" JSONB, "fetchedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "instagram_posts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "instagram_posts_username_shortcode_key" ON "instagram_posts"("username", "shortcode");
CREATE INDEX "instagram_posts_username_publishedAt_idx" ON "instagram_posts"("username", "publishedAt");

CREATE TABLE "mu_club_activities" (
  "id" TEXT NOT NULL, "clubId" TEXT NOT NULL, "sourceId" TEXT NOT NULL, "externalItemId" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL, "type" "MuClubActivityType" NOT NULL, "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL, "sourceUrl" TEXT NOT NULL, "publishedAt" TIMESTAMP(3), "startAt" TIMESTAMP(3),
  "deadlineAt" TIMESTAMP(3), "location" TEXT, "signupUrl" TEXT, "importance" INTEGER NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL, "raw" JSONB NOT NULL,
  "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mu_club_activities_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mu_club_activities_sourceId_externalItemId_key" ON "mu_club_activities"("sourceId", "externalItemId");
CREATE UNIQUE INDEX "mu_club_activities_clubId_contentHash_key" ON "mu_club_activities"("clubId", "contentHash");
CREATE INDEX "mu_club_activities_detectedAt_importance_idx" ON "mu_club_activities"("detectedAt", "importance");
CREATE INDEX "mu_club_activities_clubId_startAt_idx" ON "mu_club_activities"("clubId", "startAt");

CREATE TABLE "mu_monitor_state" (
  "id" TEXT NOT NULL, "runInProgress" BOOLEAN NOT NULL DEFAULT false, "runStartedAt" TIMESTAMP(3),
  "nextRunAt" TIMESTAMP(3) NOT NULL, "lastRunAt" TIMESTAMP(3), "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mu_monitor_state_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "mu_monitor_runs" (
  "id" TEXT NOT NULL, "trigger" "RunTrigger" NOT NULL, "status" "MuMonitorRunStatus" NOT NULL DEFAULT 'RUNNING',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "finishedAt" TIMESTAMP(3),
  "sourceCount" INTEGER NOT NULL DEFAULT 0, "fetchedCount" INTEGER NOT NULL DEFAULT 0,
  "activityCount" INTEGER NOT NULL DEFAULT 0, "sourceFailures" INTEGER NOT NULL DEFAULT 0, "error" TEXT,
  CONSTRAINT "mu_monitor_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "mu_monitor_runs_startedAt_idx" ON "mu_monitor_runs"("startedAt");
CREATE TABLE "mu_source_runs" (
  "id" TEXT NOT NULL, "monitorRunId" TEXT NOT NULL, "sourceId" TEXT NOT NULL, "success" BOOLEAN NOT NULL,
  "itemCount" INTEGER NOT NULL DEFAULT 0, "error" TEXT, "durationMs" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mu_source_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "mu_source_runs_monitorRunId_idx" ON "mu_source_runs"("monitorRunId");
CREATE INDEX "mu_source_runs_sourceId_createdAt_idx" ON "mu_source_runs"("sourceId", "createdAt");

ALTER TABLE "mu_club_sources" ADD CONSTRAINT "mu_club_sources_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "mu_clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "instagram_posts" ADD CONSTRAINT "instagram_posts_username_fkey" FOREIGN KEY ("username") REFERENCES "instagram_accounts"("username") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mu_club_activities" ADD CONSTRAINT "mu_club_activities_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "mu_clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mu_club_activities" ADD CONSTRAINT "mu_club_activities_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "mu_club_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mu_source_runs" ADD CONSTRAINT "mu_source_runs_monitorRunId_fkey" FOREIGN KEY ("monitorRunId") REFERENCES "mu_monitor_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mu_source_runs" ADD CONSTRAINT "mu_source_runs_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "mu_club_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
