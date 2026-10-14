-- CreateEnum
CREATE TYPE "SocialTrendSourceKind" AS ENUM ('GOOGLE_TRENDS', 'REDDIT', 'YOUTUBE', 'TIKTOK', 'INSTAGRAM', 'MANUAL');

-- CreateEnum
CREATE TYPE "SocialTrendSourceAvailability" AS ENUM ('ACTIVE', 'DISABLED', 'UNAVAILABLE', 'CREDENTIALS_REQUIRED', 'QUOTA_EXHAUSTED', 'ERROR');

-- CreateEnum
CREATE TYPE "SocialTrendRegion" AS ENUM ('US', 'CZ', 'GLOBAL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SocialTrendStage" AS ENUM ('EARLY_EMERGING', 'RAPIDLY_GROWING', 'ESTABLISHED', 'DECLINING', 'EVERGREEN', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SocialCzechMarketStatus" AS ENUM ('EARLY_OPPORTUNITY', 'EMERGING_BOTH', 'ESTABLISHED', 'UNCERTAIN', 'NOT_RELEVANT');

-- CreateEnum
CREATE TYPE "SocialTrendRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "SocialTrendFeedbackKind" AS ENUM ('RELEVANT', 'NOT_RELEVANT', 'ALREADY_SATURATED', 'GOOD_IDEA', 'PUBLISHED', 'GENERATED_LEADS');

-- CreateTable
CREATE TABLE "social_trend_profiles" (
    "ownerUserId" BIGINT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sourceRegion" TEXT NOT NULL DEFAULT 'US',
    "targetRegion" TEXT NOT NULL DEFAULT 'CZ',
    "primaryLanguage" TEXT NOT NULL DEFAULT 'cs',
    "secondaryLanguage" TEXT NOT NULL DEFAULT 'en',
    "focusTopics" TEXT[] DEFAULT ARRAY['web development', 'AI integrations', 'business automation', 'custom software', 'local AI', 'small business digitalization', 'technology entrepreneurship', 'productivity systems']::TEXT[],
    "audiences" TEXT[] DEFAULT ARRAY['Czech business owners', 'small and medium-sized companies', 'entrepreneurs', 'technology enthusiasts', 'potential clients']::TEXT[],
    "keywords" TEXT[] DEFAULT ARRAY['AI automation', 'local LLM', 'AI agents', 'business automation', 'web development', 'small business software', 'SaaS', 'developer tools']::TEXT[],
    "subreddits" TEXT[] DEFAULT ARRAY['artificial', 'LocalLLaMA', 'ChatGPT', 'Entrepreneur', 'smallbusiness', 'SaaS', 'webdev', 'technology', 'startups']::TEXT[],
    "youtubeChannelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabledSources" "SocialTrendSourceKind"[] DEFAULT ARRAY['REDDIT', 'YOUTUBE']::"SocialTrendSourceKind"[],
    "schedule" TEXT NOT NULL DEFAULT '0 7 * * *',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Prague',
    "reportSize" INTEGER NOT NULL DEFAULT 5,
    "scoringWeights" JSONB NOT NULL,
    "quotaLimits" JSONB NOT NULL,
    "retentionDays" INTEGER NOT NULL DEFAULT 180,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_trend_profiles_pkey" PRIMARY KEY ("ownerUserId")
);

-- CreateTable
CREATE TABLE "social_trend_source_configs" (
    "id" TEXT NOT NULL,
    "ownerUserId" BIGINT NOT NULL,
    "source" "SocialTrendSourceKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "availability" "SocialTrendSourceAvailability" NOT NULL DEFAULT 'DISABLED',
    "config" JSONB NOT NULL,
    "lastAttemptAt" TIMESTAMP(3),
    "lastSuccessfulAt" TIMESTAMP(3),
    "lastError" TEXT,
    "quotaDate" DATE,
    "quotaUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_trend_source_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_trend_signals" (
    "id" TEXT NOT NULL,
    "ownerUserId" BIGINT NOT NULL,
    "source" "SocialTrendSourceKind" NOT NULL,
    "externalId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "region" "SocialTrendRegion" NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metrics" JSONB NOT NULL,
    "metadata" JSONB NOT NULL,
    "clusterId" TEXT,

    CONSTRAINT "social_trend_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_trend_observations" (
    "id" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "views" BIGINT,
    "likes" BIGINT,
    "comments" BIGINT,
    "shares" BIGINT,
    "searchInterest" DOUBLE PRECISION,
    "metrics" JSONB NOT NULL,

    CONSTRAINT "social_trend_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_trend_clusters" (
    "id" TEXT NOT NULL,
    "ownerUserId" BIGINT NOT NULL,
    "canonicalKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "stage" "SocialTrendStage" NOT NULL DEFAULT 'UNKNOWN',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_trend_clusters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_trend_market_comparisons" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "researchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "SocialCzechMarketStatus" NOT NULL,
    "usEvidence" JSONB NOT NULL,
    "czEvidence" JSONB NOT NULL,
    "explanation" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "missingData" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "social_trend_market_comparisons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_trend_research_runs" (
    "id" TEXT NOT NULL,
    "ownerUserId" BIGINT NOT NULL,
    "chatId" BIGINT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "requestedSources" "SocialTrendSourceKind"[],
    "status" "SocialTrendRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "signalCount" INTEGER NOT NULL DEFAULT 0,
    "clusterCount" INTEGER NOT NULL DEFAULT 0,
    "opportunityCount" INTEGER NOT NULL DEFAULT 0,
    "sourceFailures" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "social_trend_research_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_trend_source_runs" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "source" "SocialTrendSourceKind" NOT NULL,
    "status" "SocialTrendSourceAvailability" NOT NULL,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "quotaUsed" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_trend_source_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_trend_opportunities" (
    "id" TEXT NOT NULL,
    "ownerUserId" BIGINT NOT NULL,
    "runId" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "czechMarketStatus" "SocialCzechMarketStatus" NOT NULL,
    "opportunityScore" INTEGER NOT NULL,
    "confidence" INTEGER NOT NULL,
    "usMomentumScore" INTEGER NOT NULL,
    "czechOpportunityScore" INTEGER NOT NULL,
    "audienceRelevanceScore" INTEGER NOT NULL,
    "businessPotentialScore" INTEGER NOT NULL,
    "contentFeasibilityScore" INTEGER NOT NULL,
    "evidenceQualityScore" INTEGER NOT NULL,
    "missingData" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "explanation" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "contentConcept" JSONB NOT NULL,
    "recommendedChannel" "SocialChannel" NOT NULL,
    "recommendedFormat" "SocialContentFormat" NOT NULL,
    "objective" "SocialBusinessObjective" NOT NULL,
    "estimatedEffortMinutes" INTEGER NOT NULL,
    "contentIdeaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_trend_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_trend_feedback" (
    "id" TEXT NOT NULL,
    "ownerUserId" BIGINT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "kind" "SocialTrendFeedbackKind" NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_trend_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_trend_reports" (
    "id" TEXT NOT NULL,
    "ownerUserId" BIGINT NOT NULL,
    "runId" TEXT NOT NULL,
    "researchDate" DATE NOT NULL,
    "contentHash" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "report" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_trend_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_trend_source_configs_ownerUserId_enabled_availabilit_idx" ON "social_trend_source_configs"("ownerUserId", "enabled", "availability");

-- CreateIndex
CREATE UNIQUE INDEX "social_trend_source_configs_ownerUserId_source_key" ON "social_trend_source_configs"("ownerUserId", "source");

-- CreateIndex
CREATE INDEX "social_trend_signals_ownerUserId_region_collectedAt_idx" ON "social_trend_signals"("ownerUserId", "region", "collectedAt");

-- CreateIndex
CREATE INDEX "social_trend_signals_clusterId_collectedAt_idx" ON "social_trend_signals"("clusterId", "collectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "social_trend_signals_ownerUserId_source_externalId_key" ON "social_trend_signals"("ownerUserId", "source", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "social_trend_signals_ownerUserId_fingerprint_key" ON "social_trend_signals"("ownerUserId", "fingerprint");

-- CreateIndex
CREATE INDEX "social_trend_observations_signalId_observedAt_idx" ON "social_trend_observations"("signalId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "social_trend_observations_signalId_observedAt_key" ON "social_trend_observations"("signalId", "observedAt");

-- CreateIndex
CREATE INDEX "social_trend_clusters_ownerUserId_stage_lastSeenAt_idx" ON "social_trend_clusters"("ownerUserId", "stage", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "social_trend_clusters_ownerUserId_canonicalKey_key" ON "social_trend_clusters"("ownerUserId", "canonicalKey");

-- CreateIndex
CREATE INDEX "social_trend_market_comparisons_clusterId_researchedAt_idx" ON "social_trend_market_comparisons"("clusterId", "researchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "social_trend_research_runs_idempotencyKey_key" ON "social_trend_research_runs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "social_trend_research_runs_ownerUserId_startedAt_idx" ON "social_trend_research_runs"("ownerUserId", "startedAt");

-- CreateIndex
CREATE INDEX "social_trend_research_runs_status_startedAt_idx" ON "social_trend_research_runs"("status", "startedAt");

-- CreateIndex
CREATE INDEX "social_trend_source_runs_source_createdAt_idx" ON "social_trend_source_runs"("source", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "social_trend_source_runs_runId_source_key" ON "social_trend_source_runs"("runId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "social_trend_opportunities_fingerprint_key" ON "social_trend_opportunities"("fingerprint");

-- CreateIndex
CREATE INDEX "social_trend_opportunities_ownerUserId_opportunityScore_cre_idx" ON "social_trend_opportunities"("ownerUserId", "opportunityScore", "createdAt");

-- CreateIndex
CREATE INDEX "social_trend_opportunities_clusterId_createdAt_idx" ON "social_trend_opportunities"("clusterId", "createdAt");

-- CreateIndex
CREATE INDEX "social_trend_feedback_ownerUserId_kind_createdAt_idx" ON "social_trend_feedback"("ownerUserId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "social_trend_feedback_opportunityId_createdAt_idx" ON "social_trend_feedback"("opportunityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "social_trend_reports_runId_key" ON "social_trend_reports"("runId");

-- CreateIndex
CREATE INDEX "social_trend_reports_ownerUserId_researchDate_idx" ON "social_trend_reports"("ownerUserId", "researchDate");

-- CreateIndex
CREATE UNIQUE INDEX "social_trend_reports_ownerUserId_researchDate_contentHash_key" ON "social_trend_reports"("ownerUserId", "researchDate", "contentHash");

-- AddForeignKey
ALTER TABLE "social_trend_signals" ADD CONSTRAINT "social_trend_signals_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "social_trend_clusters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_trend_observations" ADD CONSTRAINT "social_trend_observations_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "social_trend_signals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_trend_market_comparisons" ADD CONSTRAINT "social_trend_market_comparisons_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "social_trend_clusters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_trend_source_runs" ADD CONSTRAINT "social_trend_source_runs_runId_fkey" FOREIGN KEY ("runId") REFERENCES "social_trend_research_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_trend_opportunities" ADD CONSTRAINT "social_trend_opportunities_runId_fkey" FOREIGN KEY ("runId") REFERENCES "social_trend_research_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_trend_opportunities" ADD CONSTRAINT "social_trend_opportunities_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "social_trend_clusters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_trend_opportunities" ADD CONSTRAINT "social_trend_opportunities_contentIdeaId_fkey" FOREIGN KEY ("contentIdeaId") REFERENCES "social_content_ideas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_trend_feedback" ADD CONSTRAINT "social_trend_feedback_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "social_trend_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_trend_reports" ADD CONSTRAINT "social_trend_reports_runId_fkey" FOREIGN KEY ("runId") REFERENCES "social_trend_research_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
