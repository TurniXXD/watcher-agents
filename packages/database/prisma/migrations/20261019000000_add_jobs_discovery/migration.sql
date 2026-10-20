-- CreateEnum
CREATE TYPE "JobEligibilityState" AS ENUM ('ELIGIBLE', 'INELIGIBLE', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "JobRecommendationLevel" AS ENUM ('EXCELLENT', 'STRONG', 'POSSIBLE', 'LOW');

-- CreateEnum
CREATE TYPE "JobAvailabilityStatus" AS ENUM ('OPEN_CONFIRMED', 'LISTED_UNVERIFIED', 'CLOSED_CONFIRMED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "JobApplicationStatus" AS ENUM ('NEW', 'SAVED', 'DISMISSED', 'INTERESTED', 'APPLIED', 'RECRUITER_CONTACTED', 'INTERVIEW_SCHEDULED', 'TECHNICAL_INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "JobNotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "job_candidate_profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "professionalTitle" TEXT NOT NULL,
    "yearsExperience" INTEGER NOT NULL,
    "educationLevel" TEXT NOT NULL,
    "languages" JSONB NOT NULL,
    "preferredRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "avoidedRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferredLocations" JSONB NOT NULL,
    "profileData" JSONB NOT NULL,
    "scoringWeights" JSONB NOT NULL,
    "excellentThreshold" INTEGER NOT NULL DEFAULT 85,
    "strongThreshold" INTEGER NOT NULL DEFAULT 70,
    "possibleThreshold" INTEGER NOT NULL DEFAULT 55,
    "notificationThreshold" INTEGER NOT NULL DEFAULT 70,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_candidate_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_candidate_skills" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "proficiency" TEXT NOT NULL,
    "years" INTEGER,
    "verified" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "job_candidate_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_sources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "collectionStrategy" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "fetchIntervalMinutes" INTEGER NOT NULL DEFAULT 240,
    "rateLimitPerMinute" INTEGER NOT NULL DEFAULT 30,
    "healthStatus" "SourceHealthStatus" NOT NULL DEFAULT 'UNAVAILABLE',
    "termsNote" TEXT,
    "disabledReason" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastSuccessfulAt" TIMESTAMP(3),
    "lastError" TEXT,
    "discoveredCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_source_checkpoints" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "checkpointKey" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "etag" TEXT,
    "lastModified" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_source_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_scrape_runs" (
    "id" TEXT NOT NULL,
    "trigger" "RunTrigger" NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "baseline" BOOLEAN NOT NULL DEFAULT false,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "discoveredCount" INTEGER NOT NULL DEFAULT 0,
    "newCount" INTEGER NOT NULL DEFAULT 0,
    "evaluatedCount" INTEGER NOT NULL DEFAULT 0,
    "notifiedCount" INTEGER NOT NULL DEFAULT 0,
    "sourceFailures" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "job_scrape_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_raw_jobs" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "jobId" TEXT,
    "listingUrl" TEXT NOT NULL,
    "listingHash" TEXT NOT NULL,
    "detailHash" TEXT,
    "contentHash" TEXT NOT NULL,
    "rawListing" JSONB NOT NULL,
    "rawDetail" JSONB,
    "etag" TEXT,
    "lastModified" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDetailFetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_raw_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "canonicalFingerprint" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "normalizedCompany" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "shortDescription" TEXT,
    "location" TEXT,
    "country" TEXT,
    "city" TEXT,
    "workMode" TEXT NOT NULL,
    "remoteRegions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "salaryMin" INTEGER,
    "salaryMax" INTEGER,
    "salaryCurrency" TEXT,
    "salaryPeriod" TEXT,
    "contractType" TEXT,
    "seniority" TEXT,
    "technologyStack" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "originalUrl" TEXT NOT NULL,
    "canonicalApplicationUrl" TEXT,
    "publishedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDetailFetchedAt" TIMESTAMP(3),
    "contentHash" TEXT NOT NULL,
    "availabilityStatus" "JobAvailabilityStatus" NOT NULL DEFAULT 'LISTED_UNVERIFIED',
    "lastAvailabilityCheckAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_source_references" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "canonicalApplicationUrl" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_source_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_requirements" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "importance" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "normalized" TEXT,
    "evidence" TEXT,

    CONSTRAINT "job_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_evaluations" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "profileVersion" INTEGER NOT NULL,
    "jobContentHash" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "eligibility" "JobEligibilityState" NOT NULL,
    "recommendation" "JobRecommendationLevel" NOT NULL,
    "matchingSkills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "missingSkills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hardBlockers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "uncertainties" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reasoning" TEXT NOT NULL,
    "scoreBreakdown" JSONB NOT NULL,
    "aiProvider" TEXT,
    "aiModel" TEXT,
    "promptVersion" TEXT,
    "tokenUsage" JSONB,
    "estimatedCostUsd" DECIMAL(12,6),
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_evaluation_versions" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "profileVersion" INTEGER NOT NULL,
    "jobContentHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_evaluation_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_notifications" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "notificationKey" TEXT NOT NULL,
    "status" "JobNotificationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "job_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_notification_deliveries" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" "JobNotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "deliveredAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_applications" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" "JobApplicationStatus" NOT NULL DEFAULT 'NEW',
    "unread" BOOLEAN NOT NULL DEFAULT true,
    "saved" BOOLEAN NOT NULL DEFAULT false,
    "followUpAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_application_notes" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_application_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_source_errors" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "runId" TEXT,
    "errorCode" TEXT,
    "message" TEXT NOT NULL,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_source_errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_schedules" (
    "id" TEXT NOT NULL,
    "scheduleKey" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Prague',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastStatus" "RunStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_candidate_profiles_active_updatedAt_idx" ON "job_candidate_profiles"("active", "updatedAt");

-- CreateIndex
CREATE INDEX "job_candidate_skills_normalized_idx" ON "job_candidate_skills"("normalized");

-- CreateIndex
CREATE UNIQUE INDEX "job_candidate_skills_profileId_normalized_key" ON "job_candidate_skills"("profileId", "normalized");

-- CreateIndex
CREATE INDEX "job_sources_enabled_healthStatus_idx" ON "job_sources"("enabled", "healthStatus");

-- CreateIndex
CREATE UNIQUE INDEX "job_source_checkpoints_sourceId_checkpointKey_key" ON "job_source_checkpoints"("sourceId", "checkpointKey");

-- CreateIndex
CREATE INDEX "job_scrape_runs_startedAt_idx" ON "job_scrape_runs"("startedAt");

-- CreateIndex
CREATE INDEX "job_raw_jobs_jobId_idx" ON "job_raw_jobs"("jobId");

-- CreateIndex
CREATE INDEX "job_raw_jobs_sourceId_lastSeenAt_idx" ON "job_raw_jobs"("sourceId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "job_raw_jobs_sourceId_externalId_key" ON "job_raw_jobs"("sourceId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_canonicalFingerprint_key" ON "jobs"("canonicalFingerprint");

-- CreateIndex
CREATE INDEX "jobs_publishedAt_idx" ON "jobs"("publishedAt");

-- CreateIndex
CREATE INDEX "jobs_availabilityStatus_lastSeenAt_idx" ON "jobs"("availabilityStatus", "lastSeenAt");

-- CreateIndex
CREATE INDEX "jobs_normalizedCompany_normalizedTitle_idx" ON "jobs"("normalizedCompany", "normalizedTitle");

-- CreateIndex
CREATE INDEX "job_source_references_jobId_idx" ON "job_source_references"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "job_source_references_sourceId_externalId_key" ON "job_source_references"("sourceId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "job_source_references_jobId_sourceUrl_key" ON "job_source_references"("jobId", "sourceUrl");

-- CreateIndex
CREATE INDEX "job_requirements_jobId_category_importance_idx" ON "job_requirements"("jobId", "category", "importance");

-- CreateIndex
CREATE INDEX "job_evaluations_profileId_score_eligibility_idx" ON "job_evaluations"("profileId", "score", "eligibility");

-- CreateIndex
CREATE UNIQUE INDEX "job_evaluations_jobId_profileId_key" ON "job_evaluations"("jobId", "profileId");

-- CreateIndex
CREATE UNIQUE INDEX "job_evaluation_versions_evaluationId_profileVersion_jobCont_key" ON "job_evaluation_versions"("evaluationId", "profileVersion", "jobContentHash");

-- CreateIndex
CREATE UNIQUE INDEX "job_notifications_notificationKey_key" ON "job_notifications"("notificationKey");

-- CreateIndex
CREATE INDEX "job_notifications_status_createdAt_idx" ON "job_notifications"("status", "createdAt");

-- CreateIndex
CREATE INDEX "job_notification_deliveries_status_updatedAt_idx" ON "job_notification_deliveries"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "job_notification_deliveries_notificationId_provider_recipie_key" ON "job_notification_deliveries"("notificationId", "provider", "recipient");

-- CreateIndex
CREATE UNIQUE INDEX "job_applications_jobId_key" ON "job_applications"("jobId");

-- CreateIndex
CREATE INDEX "job_applications_status_updatedAt_idx" ON "job_applications"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "job_applications_unread_saved_idx" ON "job_applications"("unread", "saved");

-- CreateIndex
CREATE INDEX "job_application_notes_applicationId_createdAt_idx" ON "job_application_notes"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "job_source_errors_sourceId_occurredAt_idx" ON "job_source_errors"("sourceId", "occurredAt");

-- CreateIndex
CREATE INDEX "job_source_errors_runId_idx" ON "job_source_errors"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "job_schedules_scheduleKey_key" ON "job_schedules"("scheduleKey");

-- CreateIndex
CREATE INDEX "job_schedules_enabled_nextRunAt_idx" ON "job_schedules"("enabled", "nextRunAt");

-- AddForeignKey
ALTER TABLE "job_candidate_skills" ADD CONSTRAINT "job_candidate_skills_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "job_candidate_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_source_checkpoints" ADD CONSTRAINT "job_source_checkpoints_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "job_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_raw_jobs" ADD CONSTRAINT "job_raw_jobs_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "job_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_raw_jobs" ADD CONSTRAINT "job_raw_jobs_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_source_references" ADD CONSTRAINT "job_source_references_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_source_references" ADD CONSTRAINT "job_source_references_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "job_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_requirements" ADD CONSTRAINT "job_requirements_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_evaluations" ADD CONSTRAINT "job_evaluations_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_evaluations" ADD CONSTRAINT "job_evaluations_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "job_candidate_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_evaluation_versions" ADD CONSTRAINT "job_evaluation_versions_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "job_evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_notifications" ADD CONSTRAINT "job_notifications_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_notifications" ADD CONSTRAINT "job_notifications_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "job_evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_notification_deliveries" ADD CONSTRAINT "job_notification_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "job_notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_application_notes" ADD CONSTRAINT "job_application_notes_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_source_errors" ADD CONSTRAINT "job_source_errors_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "job_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_source_errors" ADD CONSTRAINT "job_source_errors_runId_fkey" FOREIGN KEY ("runId") REFERENCES "job_scrape_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

