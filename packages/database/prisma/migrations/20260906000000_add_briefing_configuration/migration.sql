CREATE TYPE "BriefingVoice" AS ENUM ('AMY', 'HFC_FEMALE', 'HFC_MALE');
CREATE TYPE "BriefingOnboardingStep" AS ENUM ('LOCATION', 'VOICE', 'GOOGLE_CALENDAR', 'SUBSCRIPTIONS', 'BRIEFING_TIME', 'COMPLETE');
CREATE TYPE "BriefingLocationMode" AS ENUM ('STATIC', 'LAST_SHARED', 'DISABLED');
CREATE TYPE "BriefingRunType" AS ENUM ('SCHEDULED', 'MANUAL', 'TEST');
CREATE TYPE "BriefingRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

CREATE TABLE "briefing_settings" (
    "id" TEXT NOT NULL,
    "telegramChatId" BIGINT NOT NULL,
    "onboardingComplete" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT NOT NULL DEFAULT 'en',
    "voice" "BriefingVoice" NOT NULL DEFAULT 'AMY',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Prague',
    "briefingTime" TEXT NOT NULL DEFAULT '07:00',
    "targetDurationMinutes" INTEGER NOT NULL DEFAULT 7,
    "maximumDurationMinutes" INTEGER NOT NULL DEFAULT 15,
    "sendTranscript" BOOLEAN NOT NULL DEFAULT false,
    "calendarEnabled" BOOLEAN NOT NULL DEFAULT false,
    "weatherEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "briefing_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "briefing_settings_time_check" CHECK ("briefingTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    CONSTRAINT "briefing_settings_duration_check" CHECK (
      "targetDurationMinutes" BETWEEN 1 AND 30 AND
      "maximumDurationMinutes" BETWEEN "targetDurationMinutes" AND 30
    )
);

CREATE TABLE "briefing_subscriptions" (
    "id" TEXT NOT NULL,
    "settingsId" TEXT NOT NULL,
    "watcherBot" "BriefingWatcherBot" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "briefing_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "briefing_locations" (
    "id" TEXT NOT NULL,
    "settingsId" TEXT NOT NULL,
    "mode" "BriefingLocationMode" NOT NULL,
    "city" TEXT,
    "country" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "briefing_locations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "briefing_locations_coordinates_check" CHECK (
      ("mode" = 'DISABLED' AND "latitude" IS NULL AND "longitude" IS NULL) OR
      ("mode" <> 'DISABLED' AND "latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)
    )
);

CREATE TABLE "onboarding_state" (
    "id" TEXT NOT NULL,
    "settingsId" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "currentStep" "BriefingOnboardingStep" NOT NULL DEFAULT 'LOCATION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "onboarding_state_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "briefing_runs" (
    "id" TEXT NOT NULL,
    "settingsId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "type" "BriefingRunType" NOT NULL,
    "scheduledFor" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "subscriptions" "BriefingWatcherBot"[],
    "location" JSONB,
    "weatherAvailable" BOOLEAN NOT NULL DEFAULT false,
    "calendarAvailable" BOOLEAN NOT NULL DEFAULT false,
    "status" "BriefingRunStatus" NOT NULL DEFAULT 'RUNNING',
    "selectedStoryIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "displayScript" TEXT,
    "ttsScript" TEXT,
    "wordCount" INTEGER,
    "targetDurationSeconds" INTEGER NOT NULL,
    "maximumDurationSeconds" INTEGER NOT NULL,
    "actualAudioDurationSeconds" DOUBLE PRECISION,
    "voice" "BriefingVoice",
    "telegramMessageId" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "briefing_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "briefing_runs_period_check" CHECK ("periodStart" <= "periodEnd"),
    CONSTRAINT "briefing_runs_duration_check" CHECK (
      "targetDurationSeconds" > 0 AND
      "maximumDurationSeconds" >= "targetDurationSeconds"
    )
);

CREATE TABLE "briefing_story_states" (
    "id" TEXT NOT NULL,
    "settingsId" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "firstMentionedAt" TIMESTAMP(3) NOT NULL,
    "lastMentionedAt" TIMESTAMP(3) NOT NULL,
    "lastSummary" TEXT NOT NULL,
    "importance" INTEGER NOT NULL,
    "status" "BriefingEventStatus" NOT NULL,
    "lastBriefingRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "briefing_story_states_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "briefing_story_states_importance_check" CHECK ("importance" BETWEEN 0 AND 100),
    CONSTRAINT "briefing_story_states_dates_check" CHECK ("firstMentionedAt" <= "lastMentionedAt")
);

CREATE UNIQUE INDEX "briefing_settings_telegramChatId_key" ON "briefing_settings"("telegramChatId");
CREATE UNIQUE INDEX "briefing_subscriptions_settingsId_watcherBot_key" ON "briefing_subscriptions"("settingsId", "watcherBot");
CREATE INDEX "briefing_subscriptions_settingsId_enabled_idx" ON "briefing_subscriptions"("settingsId", "enabled");
CREATE UNIQUE INDEX "briefing_locations_settingsId_key" ON "briefing_locations"("settingsId");
CREATE UNIQUE INDEX "onboarding_state_settingsId_key" ON "onboarding_state"("settingsId");
CREATE UNIQUE INDEX "briefing_runs_idempotencyKey_key" ON "briefing_runs"("idempotencyKey");
CREATE INDEX "briefing_runs_settingsId_type_status_startedAt_idx" ON "briefing_runs"("settingsId", "type", "status", "startedAt");
CREATE INDEX "briefing_runs_settingsId_periodEnd_idx" ON "briefing_runs"("settingsId", "periodEnd");
CREATE UNIQUE INDEX "briefing_story_states_settingsId_storyId_key" ON "briefing_story_states"("settingsId", "storyId");
CREATE INDEX "briefing_story_states_settingsId_status_lastMentionedAt_idx" ON "briefing_story_states"("settingsId", "status", "lastMentionedAt");

ALTER TABLE "briefing_subscriptions" ADD CONSTRAINT "briefing_subscriptions_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "briefing_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "briefing_locations" ADD CONSTRAINT "briefing_locations_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "briefing_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "onboarding_state" ADD CONSTRAINT "onboarding_state_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "briefing_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "briefing_runs" ADD CONSTRAINT "briefing_runs_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "briefing_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "briefing_story_states" ADD CONSTRAINT "briefing_story_states_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "briefing_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "briefing_story_states" ADD CONSTRAINT "briefing_story_states_lastBriefingRunId_fkey" FOREIGN KEY ("lastBriefingRunId") REFERENCES "briefing_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
