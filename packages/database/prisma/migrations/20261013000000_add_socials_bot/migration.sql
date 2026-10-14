-- CreateEnum
CREATE TYPE "SocialProjectStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SocialVisibility" AS ENUM ('PUBLIC', 'PRIVATE', 'CONFIDENTIAL');

-- CreateEnum
CREATE TYPE "SocialTopicStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SocialIdeaStatus" AS ENUM ('BACKLOG', 'PLANNED', 'USED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SocialPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "SocialBusinessObjective" AS ENUM ('QUALIFIED_LEADS', 'CREDIBILITY', 'PERSONAL_BRAND', 'AUDIENCE_GROWTH', 'TRAFFIC', 'NEWSLETTER_GROWTH', 'LEARNING');

-- CreateEnum
CREATE TYPE "SocialChannel" AS ENUM ('LINKEDIN', 'INSTAGRAM', 'BLOG', 'NEWSLETTER');

-- CreateEnum
CREATE TYPE "SocialContentFormat" AS ENUM ('TEXT_POST', 'REEL', 'CAROUSEL', 'STORY', 'BLOG_ARTICLE', 'NEWSLETTER_ISSUE');

-- CreateEnum
CREATE TYPE "SocialContentStatus" AS ENUM ('IDEA', 'PLANNED', 'PROMPT_READY', 'DRAFT', 'READY', 'SCHEDULED', 'PUBLISHED', 'SKIPPED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SocialVersionSource" AS ENUM ('MANUAL', 'CHATGPT', 'LOCAL_LLM', 'IMPORTED', 'NOTION');

-- CreateEnum
CREATE TYPE "SocialVerificationStatus" AS ENUM ('UNVERIFIED', 'PARTIALLY_VERIFIED', 'VERIFIED', 'STALE', 'FAILED');

-- CreateEnum
CREATE TYPE "SocialWeeklyPlanStatus" AS ENUM ('DRAFT', 'APPROVED', 'SKIPPED', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SocialSyncStatus" AS ENUM ('PENDING', 'SYNCED', 'CONFLICT', 'FAILED');

-- CreateEnum
CREATE TYPE "SocialSchedulerStatus" AS ENUM ('PENDING', 'CLAIMED', 'COMPLETED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "SocialEventFormat" AS ENUM ('IN_PERSON', 'ONLINE', 'HYBRID', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SocialPriceStatus" AS ENUM ('FREE', 'PAID', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SocialAccessType" AS ENUM ('PUBLIC', 'REGISTRATION_REQUIRED', 'MEMBERS_ONLY', 'INVITE_ONLY', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SocialEventStatus" AS ENUM ('SCHEDULED', 'CANCELLED', 'POSTPONED', 'COMPLETED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SocialAttendanceStatus" AS ENUM ('SUGGESTED', 'INTERESTED', 'REGISTERED', 'ATTENDED', 'MISSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SocialFollowUpStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "social_projects" (
    "id" TEXT NOT NULL,
    "ownerUserId" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "technologies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "SocialProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "repositoryUrl" TEXT,
    "websiteUrl" TEXT,
    "visibility" "SocialVisibility" NOT NULL DEFAULT 'PRIVATE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_topics" (
    "id" TEXT NOT NULL,
    "ownerUserId" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "pillar" TEXT NOT NULL,
    "status" "SocialTopicStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_sources" (
    "id" TEXT NOT NULL,
    "ownerUserId" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "canonicalUrl" TEXT,
    "sourceType" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "accessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summary" TEXT,
    "verificationStatus" "SocialVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_content_ideas" (
    "id" TEXT NOT NULL,
    "ownerUserId" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceReference" TEXT,
    "status" "SocialIdeaStatus" NOT NULL DEFAULT 'BACKLOG',
    "priority" "SocialPriority" NOT NULL DEFAULT 'MEDIUM',
    "businessObjective" "SocialBusinessObjective" NOT NULL DEFAULT 'QUALIFIED_LEADS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_content_ideas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_idea_topics" (
    "ideaId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,

    CONSTRAINT "social_idea_topics_pkey" PRIMARY KEY ("ideaId","topicId")
);

-- CreateTable
CREATE TABLE "social_idea_projects" (
    "ideaId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "social_idea_projects_pkey" PRIMARY KEY ("ideaId","projectId")
);

-- CreateTable
CREATE TABLE "social_idea_sources" (
    "ideaId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,

    CONSTRAINT "social_idea_sources_pkey" PRIMARY KEY ("ideaId","sourceId")
);

-- CreateTable
CREATE TABLE "social_telegram_sessions" (
    "id" TEXT NOT NULL,
    "ownerUserId" BIGINT NOT NULL,
    "chatId" BIGINT NOT NULL,
    "sessionType" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_telegram_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_weekly_plans" (
    "id" TEXT NOT NULL,
    "ownerUserId" BIGINT NOT NULL,
    "weekStart" DATE NOT NULL,
    "weekEnd" DATE NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "SocialWeeklyPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "planningSessionId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_weekly_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_content_items" (
    "id" TEXT NOT NULL,
    "ownerUserId" BIGINT NOT NULL,
    "ideaId" TEXT NOT NULL,
    "weeklyPlanId" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT,
    "channel" "SocialChannel" NOT NULL,
    "format" "SocialContentFormat" NOT NULL,
    "contentPillar" TEXT NOT NULL,
    "targetAudience" TEXT NOT NULL,
    "objective" "SocialBusinessObjective" NOT NULL,
    "angle" TEXT NOT NULL,
    "planningReason" TEXT NOT NULL,
    "similarityWarning" TEXT,
    "hook" TEXT,
    "outline" JSONB,
    "prompt" TEXT,
    "draft" TEXT,
    "finalContent" TEXT,
    "cta" TEXT,
    "requiredAssets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "plannedAt" TIMESTAMP(3),
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "publishedUrl" TEXT,
    "status" "SocialContentStatus" NOT NULL DEFAULT 'IDEA',
    "estimatedPreparationMinutes" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_content_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_content_item_topics" (
    "contentItemId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,

    CONSTRAINT "social_content_item_topics_pkey" PRIMARY KEY ("contentItemId","topicId")
);

-- CreateTable
CREATE TABLE "social_content_item_projects" (
    "contentItemId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "social_content_item_projects_pkey" PRIMARY KEY ("contentItemId","projectId")
);

-- CreateTable
CREATE TABLE "social_content_item_sources" (
    "contentItemId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,

    CONSTRAINT "social_content_item_sources_pkey" PRIMARY KEY ("contentItemId","sourceId")
);

-- CreateTable
CREATE TABLE "social_content_relations" (
    "fromContentItemId" TEXT NOT NULL,
    "toContentItemId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL DEFAULT 'REPURPOSED_FROM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_content_relations_pkey" PRIMARY KEY ("fromContentItemId","toContentItemId")
);

-- CreateTable
CREATE TABLE "social_content_versions" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "source" "SocialVersionSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_content_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_content_metrics" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "impressions" INTEGER,
    "reach" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "saves" INTEGER,
    "clicks" INTEGER,
    "websiteVisits" INTEGER,
    "leads" INTEGER,
    "qualifiedLeads" INTEGER,
    "customersAcquired" INTEGER,
    "notes" TEXT,

    CONSTRAINT "social_content_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_checklist_items" (
    "id" TEXT NOT NULL,
    "weeklyPlanId" TEXT NOT NULL,
    "contentItemId" TEXT,
    "title" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_content_packs" (
    "id" TEXT NOT NULL,
    "weeklyPlanId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_content_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_external_syncs" (
    "id" TEXT NOT NULL,
    "ownerUserId" BIGINT NOT NULL,
    "localEntityType" TEXT NOT NULL,
    "localEntityId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "lastLocalHash" TEXT,
    "lastRemoteEditedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "syncStatus" "SocialSyncStatus" NOT NULL DEFAULT 'PENDING',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_external_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_settings" (
    "ownerUserId" BIGINT NOT NULL,
    "chatId" BIGINT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Prague',
    "sundayReminderTime" TEXT NOT NULL DEFAULT '09:00',
    "mondayNetworkingReminder" BOOLEAN NOT NULL DEFAULT true,
    "preferredCities" TEXT[] DEFAULT ARRAY['Brno', 'Ostrava', 'Frýdek-Místek']::TEXT[],
    "travelRadiusKm" INTEGER NOT NULL DEFAULT 80,
    "maximumEventPriceCzk" INTEGER NOT NULL DEFAULT 0,
    "weeklyRecommendationCount" INTEGER NOT NULL DEFAULT 5,
    "preferredEventCategories" TEXT[] DEFAULT ARRAY['startup', 'entrepreneurship', 'business', 'programming', 'ai', 'networking']::TEXT[],
    "enabledEventSources" TEXT[] DEFAULT ARRAY['brno-events']::TEXT[],
    "reminderPreferences" JSONB NOT NULL,
    "cadence" JSONB NOT NULL,
    "pillarDistribution" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_settings_pkey" PRIMARY KEY ("ownerUserId")
);

-- CreateTable
CREATE TABLE "social_scheduled_jobs" (
    "id" TEXT NOT NULL,
    "ownerUserId" BIGINT NOT NULL,
    "chatId" BIGINT NOT NULL,
    "kind" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "SocialSchedulerStatus" NOT NULL DEFAULT 'PENDING',
    "claimedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_scheduled_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_networking_events" (
    "id" TEXT NOT NULL,
    "ownerUserId" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "description" TEXT,
    "organizer" TEXT,
    "venue" TEXT,
    "city" TEXT,
    "address" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Prague',
    "format" "SocialEventFormat" NOT NULL DEFAULT 'UNKNOWN',
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "audience" TEXT,
    "priceAmount" DECIMAL(12,2),
    "currency" TEXT,
    "priceStatus" "SocialPriceStatus" NOT NULL DEFAULT 'UNKNOWN',
    "accessType" "SocialAccessType" NOT NULL DEFAULT 'UNKNOWN',
    "registrationUrl" TEXT,
    "canonicalUrl" TEXT,
    "sourceProvider" TEXT NOT NULL,
    "sourceExternalId" TEXT,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "verificationStatus" "SocialVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "status" "SocialEventStatus" NOT NULL DEFAULT 'SCHEDULED',
    "relevanceScore" INTEGER NOT NULL DEFAULT 0,
    "relevanceReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_networking_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_networking_event_sources" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "officialUrl" TEXT,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_networking_event_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_event_attendances" (
    "id" TEXT NOT NULL,
    "ownerUserId" BIGINT NOT NULL,
    "eventId" TEXT NOT NULL,
    "weeklyPlanId" TEXT,
    "status" "SocialAttendanceStatus" NOT NULL DEFAULT 'SUGGESTED',
    "registeredAt" TIMESTAMP(3),
    "attendedAt" TIMESTAMP(3),
    "notes" TEXT,
    "highlights" TEXT,
    "lessons" TEXT,
    "privacy" "SocialVisibility" NOT NULL DEFAULT 'PRIVATE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_event_attendances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_networking_contacts" (
    "id" TEXT NOT NULL,
    "ownerUserId" BIGINT NOT NULL,
    "displayName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "organization" TEXT,
    "role" TEXT,
    "profileUrl" TEXT,
    "preferredContactMethod" TEXT,
    "notes" TEXT,
    "consentOrContext" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_networking_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_attendance_contacts" (
    "attendanceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "conversationNotes" TEXT,
    "followUpIntent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_attendance_contacts_pkey" PRIMARY KEY ("attendanceId","contactId")
);

-- CreateTable
CREATE TABLE "social_networking_follow_ups" (
    "id" TEXT NOT NULL,
    "ownerUserId" BIGINT NOT NULL,
    "contactId" TEXT NOT NULL,
    "attendanceId" TEXT,
    "title" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "SocialFollowUpStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_networking_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_event_content_ideas" (
    "eventAttendanceId" TEXT NOT NULL,
    "contentIdeaId" TEXT NOT NULL,
    "provenanceNotes" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_event_content_ideas_pkey" PRIMARY KEY ("eventAttendanceId","contentIdeaId")
);

-- CreateIndex
CREATE INDEX "social_projects_ownerUserId_status_idx" ON "social_projects"("ownerUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "social_projects_ownerUserId_normalizedName_key" ON "social_projects"("ownerUserId", "normalizedName");

-- CreateIndex
CREATE INDEX "social_topics_ownerUserId_status_pillar_idx" ON "social_topics"("ownerUserId", "status", "pillar");

-- CreateIndex
CREATE UNIQUE INDEX "social_topics_ownerUserId_slug_key" ON "social_topics"("ownerUserId", "slug");

-- CreateIndex
CREATE INDEX "social_sources_ownerUserId_sourceType_idx" ON "social_sources"("ownerUserId", "sourceType");

-- CreateIndex
CREATE UNIQUE INDEX "social_sources_ownerUserId_canonicalUrl_key" ON "social_sources"("ownerUserId", "canonicalUrl");

-- CreateIndex
CREATE INDEX "social_content_ideas_ownerUserId_status_priority_idx" ON "social_content_ideas"("ownerUserId", "status", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "social_content_ideas_ownerUserId_normalizedTitle_key" ON "social_content_ideas"("ownerUserId", "normalizedTitle");

-- CreateIndex
CREATE INDEX "social_idea_topics_topicId_idx" ON "social_idea_topics"("topicId");

-- CreateIndex
CREATE INDEX "social_idea_projects_projectId_idx" ON "social_idea_projects"("projectId");

-- CreateIndex
CREATE INDEX "social_idea_sources_sourceId_idx" ON "social_idea_sources"("sourceId");

-- CreateIndex
CREATE INDEX "social_telegram_sessions_ownerUserId_chatId_expiresAt_idx" ON "social_telegram_sessions"("ownerUserId", "chatId", "expiresAt");

-- CreateIndex
CREATE INDEX "social_weekly_plans_ownerUserId_status_weekStart_idx" ON "social_weekly_plans"("ownerUserId", "status", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "social_weekly_plans_ownerUserId_weekStart_version_key" ON "social_weekly_plans"("ownerUserId", "weekStart", "version");

-- CreateIndex
CREATE INDEX "social_content_items_ownerUserId_status_plannedAt_idx" ON "social_content_items"("ownerUserId", "status", "plannedAt");

-- CreateIndex
CREATE INDEX "social_content_items_ownerUserId_channel_publishedAt_idx" ON "social_content_items"("ownerUserId", "channel", "publishedAt");

-- CreateIndex
CREATE INDEX "social_content_items_ideaId_idx" ON "social_content_items"("ideaId");

-- CreateIndex
CREATE INDEX "social_content_item_topics_topicId_idx" ON "social_content_item_topics"("topicId");

-- CreateIndex
CREATE INDEX "social_content_item_projects_projectId_idx" ON "social_content_item_projects"("projectId");

-- CreateIndex
CREATE INDEX "social_content_item_sources_sourceId_idx" ON "social_content_item_sources"("sourceId");

-- CreateIndex
CREATE INDEX "social_content_relations_toContentItemId_idx" ON "social_content_relations"("toContentItemId");

-- CreateIndex
CREATE INDEX "social_content_versions_contentItemId_createdAt_idx" ON "social_content_versions"("contentItemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "social_content_versions_contentItemId_versionNumber_key" ON "social_content_versions"("contentItemId", "versionNumber");

-- CreateIndex
CREATE INDEX "social_content_metrics_contentItemId_recordedAt_idx" ON "social_content_metrics"("contentItemId", "recordedAt");

-- CreateIndex
CREATE INDEX "social_checklist_items_weeklyPlanId_sortOrder_idx" ON "social_checklist_items"("weeklyPlanId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "social_content_packs_weeklyPlanId_version_key" ON "social_content_packs"("weeklyPlanId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "social_content_packs_weeklyPlanId_contentHash_key" ON "social_content_packs"("weeklyPlanId", "contentHash");

-- CreateIndex
CREATE INDEX "social_external_syncs_ownerUserId_syncStatus_idx" ON "social_external_syncs"("ownerUserId", "syncStatus");

-- CreateIndex
CREATE UNIQUE INDEX "social_external_syncs_provider_externalId_key" ON "social_external_syncs"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "social_external_syncs_ownerUserId_localEntityType_localEnti_key" ON "social_external_syncs"("ownerUserId", "localEntityType", "localEntityId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "social_settings_chatId_key" ON "social_settings"("chatId");

-- CreateIndex
CREATE INDEX "social_scheduled_jobs_status_scheduledFor_idx" ON "social_scheduled_jobs"("status", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "social_scheduled_jobs_ownerUserId_kind_scheduledFor_key" ON "social_scheduled_jobs"("ownerUserId", "kind", "scheduledFor");

-- CreateIndex
CREATE INDEX "social_networking_events_ownerUserId_startAt_city_idx" ON "social_networking_events"("ownerUserId", "startAt", "city");

-- CreateIndex
CREATE INDEX "social_networking_events_ownerUserId_priceStatus_startAt_idx" ON "social_networking_events"("ownerUserId", "priceStatus", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "social_networking_events_ownerUserId_canonicalUrl_key" ON "social_networking_events"("ownerUserId", "canonicalUrl");

-- CreateIndex
CREATE UNIQUE INDEX "social_networking_events_ownerUserId_sourceProvider_sourceE_key" ON "social_networking_events"("ownerUserId", "sourceProvider", "sourceExternalId");

-- CreateIndex
CREATE INDEX "social_networking_event_sources_provider_externalId_idx" ON "social_networking_event_sources"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "social_networking_event_sources_eventId_sourceUrl_key" ON "social_networking_event_sources"("eventId", "sourceUrl");

-- CreateIndex
CREATE INDEX "social_event_attendances_ownerUserId_status_updatedAt_idx" ON "social_event_attendances"("ownerUserId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "social_event_attendances_weeklyPlanId_idx" ON "social_event_attendances"("weeklyPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "social_event_attendances_ownerUserId_eventId_key" ON "social_event_attendances"("ownerUserId", "eventId");

-- CreateIndex
CREATE INDEX "social_networking_contacts_ownerUserId_updatedAt_idx" ON "social_networking_contacts"("ownerUserId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "social_networking_contacts_ownerUserId_normalizedName_organ_key" ON "social_networking_contacts"("ownerUserId", "normalizedName", "organization");

-- CreateIndex
CREATE INDEX "social_attendance_contacts_contactId_idx" ON "social_attendance_contacts"("contactId");

-- CreateIndex
CREATE INDEX "social_networking_follow_ups_ownerUserId_status_dueAt_idx" ON "social_networking_follow_ups"("ownerUserId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "social_event_content_ideas_contentIdeaId_idx" ON "social_event_content_ideas"("contentIdeaId");

-- AddForeignKey
ALTER TABLE "social_idea_topics" ADD CONSTRAINT "social_idea_topics_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "social_content_ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_idea_topics" ADD CONSTRAINT "social_idea_topics_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "social_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_idea_projects" ADD CONSTRAINT "social_idea_projects_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "social_content_ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_idea_projects" ADD CONSTRAINT "social_idea_projects_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "social_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_idea_sources" ADD CONSTRAINT "social_idea_sources_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "social_content_ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_idea_sources" ADD CONSTRAINT "social_idea_sources_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "social_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_weekly_plans" ADD CONSTRAINT "social_weekly_plans_planningSessionId_fkey" FOREIGN KEY ("planningSessionId") REFERENCES "social_telegram_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_content_items" ADD CONSTRAINT "social_content_items_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "social_content_ideas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_content_items" ADD CONSTRAINT "social_content_items_weeklyPlanId_fkey" FOREIGN KEY ("weeklyPlanId") REFERENCES "social_weekly_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_content_item_topics" ADD CONSTRAINT "social_content_item_topics_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "social_content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_content_item_topics" ADD CONSTRAINT "social_content_item_topics_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "social_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_content_item_projects" ADD CONSTRAINT "social_content_item_projects_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "social_content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_content_item_projects" ADD CONSTRAINT "social_content_item_projects_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "social_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_content_item_sources" ADD CONSTRAINT "social_content_item_sources_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "social_content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_content_item_sources" ADD CONSTRAINT "social_content_item_sources_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "social_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_content_relations" ADD CONSTRAINT "social_content_relations_fromContentItemId_fkey" FOREIGN KEY ("fromContentItemId") REFERENCES "social_content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_content_relations" ADD CONSTRAINT "social_content_relations_toContentItemId_fkey" FOREIGN KEY ("toContentItemId") REFERENCES "social_content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_content_versions" ADD CONSTRAINT "social_content_versions_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "social_content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_content_metrics" ADD CONSTRAINT "social_content_metrics_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "social_content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_checklist_items" ADD CONSTRAINT "social_checklist_items_weeklyPlanId_fkey" FOREIGN KEY ("weeklyPlanId") REFERENCES "social_weekly_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_checklist_items" ADD CONSTRAINT "social_checklist_items_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "social_content_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_content_packs" ADD CONSTRAINT "social_content_packs_weeklyPlanId_fkey" FOREIGN KEY ("weeklyPlanId") REFERENCES "social_weekly_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_networking_event_sources" ADD CONSTRAINT "social_networking_event_sources_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "social_networking_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_event_attendances" ADD CONSTRAINT "social_event_attendances_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "social_networking_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_attendance_contacts" ADD CONSTRAINT "social_attendance_contacts_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "social_event_attendances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_attendance_contacts" ADD CONSTRAINT "social_attendance_contacts_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "social_networking_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_networking_follow_ups" ADD CONSTRAINT "social_networking_follow_ups_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "social_networking_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_networking_follow_ups" ADD CONSTRAINT "social_networking_follow_ups_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "social_event_attendances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_event_content_ideas" ADD CONSTRAINT "social_event_content_ideas_eventAttendanceId_fkey" FOREIGN KEY ("eventAttendanceId") REFERENCES "social_event_attendances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_event_content_ideas" ADD CONSTRAINT "social_event_content_ideas_contentIdeaId_fkey" FOREIGN KEY ("contentIdeaId") REFERENCES "social_content_ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
